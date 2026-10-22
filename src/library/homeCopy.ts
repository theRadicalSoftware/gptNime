import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnimeEntry, HistoryEvent, StoredState } from './model'

// The home copy keeps the ledger on this computer as well as in the browser,
// so cleared site data, a second browser or a phone on the SSH tunnel all
// continue the same library. Each browser remembers what it last agreed with
// the computer, so a change made elsewhere is never mistaken for a deletion.
const SYNC_KEY = 'gptnime-home-copy-v1'
const HEADERS = { 'X-GPTNime': 'library' }
const SAVE_DELAY_MS = 900
const CHECK_INTERVAL_MS = 45_000

export type HomeCopyMode = 'checking' | 'saved' | 'saving' | 'local' | 'offline'
export type HomeCopyStatus = { mode: HomeCopyMode; savedAt: string | null; persisted: boolean | null }
export type BackupInfo = { date: string; savedAt: string; titles: number }

type Remote = { revision: number; savedAt: string | null; library?: AnimeEntry[]; history?: HistoryEvent[] }
type SyncRecord = { revision: number; entries: Record<string, string> }

export function fingerprint(value: unknown) {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`
}

const time = (value?: string) => { const parsed = new Date(value || 0).getTime(); return Number.isFinite(parsed) ? parsed : 0 }
// Each agreed title is remembered as its fingerprint and last edit time.
const entryPrints = (library: AnimeEntry[]) => Object.fromEntries(library.map((entry) => [entry.id, `${fingerprint(entry)}@${time(entry.updatedAt)}`]))

// Three-way merge per title: whichever side changed since the last agreement
// wins; when both changed, the more recent edit wins. Titles removed on one
// side stay removed unless the other side edited them meanwhile.
export function mergeLibraries(local: AnimeEntry[], remote: AnimeEntry[], agreed: Record<string, string> | null): AnimeEntry[] {
  // A browser whose own library is empty (cleared or unreadable storage) has
  // nothing to delete: it adopts the computer's copy.
  const base = local.length ? agreed : null
  const remoteById = new Map(remote.map((entry) => [entry.id, entry]))
  const localIds = new Set(local.map((entry) => entry.id))
  const changed = (entry: AnimeEntry | undefined, id: string) => !base || (entry ? fingerprint(entry) : undefined) !== base[id]?.split('@')[0]
  const pick = (id: string, mine?: AnimeEntry, theirs?: AnimeEntry) => {
    // An older copy than the one last agreed is out of date, not an edit.
    const stale = !!base?.[id] && !!mine && time(mine.updatedAt) < Number(base[id].split('@')[1])
    if (!changed(mine, id) || stale) return theirs
    if (!changed(theirs, id)) return mine
    if (!mine || !theirs) return mine || theirs
    return time(theirs.updatedAt) > time(mine.updatedAt) ? theirs : mine
  }
  const merged = [
    ...remote.filter((entry) => !localIds.has(entry.id)).map((entry) => pick(entry.id, undefined, entry)),
    ...local.map((entry) => pick(entry.id, entry, remoteById.get(entry.id))),
  ].filter((entry): entry is AnimeEntry => Boolean(entry))
  // Mass removal is never inferred: keeping both sides is the safe outcome.
  const kept = new Set(merged.map((entry) => entry.id))
  const removed = remote.filter((entry) => !kept.has(entry.id)).length
  if (base && removed >= 5 && removed > remote.length * 0.3) return mergeLibraries(local, remote, null)
  // The same show added separately in two places keeps its most recent record.
  const byShow = new Map<number, AnimeEntry>()
  for (const entry of merged) {
    const existing = byShow.get(entry.anilistId)
    if (!existing || time(entry.updatedAt) > time(existing.updatedAt)) byShow.set(entry.anilistId, entry)
  }
  return merged.filter((entry) => byShow.get(entry.anilistId) === entry)
}

export function mergeHistory(local: HistoryEvent[], remote: HistoryEvent[]) {
  const seen = new Set<string>()
  return [...local, ...remote]
    .filter((event) => !seen.has(event.id) && Boolean(seen.add(event.id)))
    .sort((first, second) => time(second.at) - time(first.at))
    .slice(0, 500)
}

function readRecord(): SyncRecord | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null')
    return parsed && Number.isInteger(parsed.revision) && parsed.entries && typeof parsed.entries === 'object' ? parsed : null
  } catch { return null }
}

function writeRecord(record: SyncRecord) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(record)) } catch { /* The next sync merges without a base. */ }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, cache: 'no-store', headers: { ...HEADERS, ...(init?.headers || {}) } })
  return { response, body: await response.json().catch(() => null) }
}

export async function listBackups(): Promise<BackupInfo[]> {
  const { response, body } = await request('/api/library/backups')
  if (!response.ok || !Array.isArray(body?.backups)) throw new Error('Backups are available when GPTNime runs from its launcher.')
  return body.backups
}

export async function readBackup(date: string): Promise<string> {
  const response = await fetch(`/api/library/backups/${encodeURIComponent(date)}`, { cache: 'no-store', headers: HEADERS })
  if (!response.ok) throw new Error('That backup could not be opened.')
  return response.text()
}

// normalize validates every copy that arrives from the computer, exactly as
// the app validates its own stored library.
export function useHomeCopy(state: StoredState, apply: (state: StoredState) => void, blocked: boolean, normalize: (value: unknown) => StoredState): HomeCopyStatus {
  const [status, setStatus] = useState<HomeCopyStatus>({ mode: 'checking', savedAt: null, persisted: null })
  const stateRef = useRef(state)
  stateRef.current = state
  const applyRef = useRef(apply)
  applyRef.current = apply
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const normalizeRef = useRef(normalize)
  normalizeRef.current = normalize
  const sync = useRef({ ready: false, revision: 0, base: null as Record<string, string> | null, agreed: '', busy: false, again: false })

  const agree = useCallback((revision: number, agreed: StoredState, savedAt: string | null) => {
    const current = sync.current
    current.revision = revision
    current.base = entryPrints(agreed.library)
    current.agreed = fingerprint(agreed)
    writeRecord({ revision, entries: current.base })
    setStatus((previous) => ({ ...previous, mode: 'saved', savedAt: savedAt || previous.savedAt }))
  }, [])

  const save = useCallback(async (next: StoredState, base: number): Promise<void> => {
    const current = sync.current
    if (blockedRef.current) return
    if (current.busy) { current.again = true; return }
    current.busy = true
    setStatus((previous) => ({ ...previous, mode: 'saving' }))
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { response, body } = await request('/api/library', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, state: next }),
        })
        if (response.ok) { agree(body.revision, next, body.savedAt); break }
        if (response.status !== 409 || !body) throw new Error('save failed')
        // Another device saved first: merge its copy in, then try once more.
        const theirs = normalizeRef.current(body)
        const merged: StoredState = {
          library: mergeLibraries(stateRef.current.library, theirs.library, current.base),
          history: mergeHistory(stateRef.current.history, theirs.history),
        }
        if (fingerprint(merged) !== fingerprint(stateRef.current)) applyRef.current(merged)
        if (fingerprint(merged) === fingerprint({ library: body.library || [], history: body.history || [] })) { agree(body.revision, merged, body.savedAt); break }
        next = merged
        base = body.revision
      }
    } catch {
      setStatus((previous) => ({ ...previous, mode: 'offline' }))
    } finally {
      current.busy = false
      if (current.again) {
        current.again = false
        if (fingerprint(stateRef.current) !== current.agreed) void save(stateRef.current, current.revision)
      }
    }
  }, [agree])

  // Folds the computer's copy into this browser's, then saves the result back
  // if this browser had anything the computer did not.
  const reconcile = useCallback(async (remote: Remote) => {
    const local = stateRef.current
    const theirs = normalizeRef.current(remote)
    const merged: StoredState = {
      library: mergeLibraries(local.library, theirs.library, sync.current.base),
      history: mergeHistory(local.history, theirs.history),
    }
    const print = fingerprint(merged)
    if (print !== fingerprint(local)) applyRef.current(merged)
    if (print === fingerprint({ library: remote.library || [], history: remote.history || [] })) agree(remote.revision, merged, remote.savedAt)
    else await save(merged, remote.revision)
  }, [agree, save])

  const check = useCallback(async () => {
    const current = sync.current
    if (!current.ready || current.busy || document.visibilityState === 'hidden') return
    try {
      const { response, body } = await request('/api/library/revision')
      if (!response.ok) return
      if (body.revision !== current.revision) {
        const full = await request('/api/library')
        if (full.response.ok && !current.busy) await reconcile(full.body)
      } else if (status.mode === 'offline' && fingerprint(stateRef.current) !== current.agreed) {
        await save(stateRef.current, current.revision)
      }
    } catch { setStatus((previous) => ({ ...previous, mode: 'offline' })) }
  }, [reconcile, save, status.mode])

  useEffect(() => {
    let cancelled = false
    const storage = navigator.storage
    // Ask the browser to keep this site's storage through cleanup; it may say no.
    void (async () => {
      try {
        const persisted = await storage?.persisted?.() || await storage?.persist?.() || false
        if (!cancelled) setStatus((previous) => ({ ...previous, persisted }))
      } catch { /* Unsupported here. */ }
    })()
    void (async () => {
      try {
        const { response, body } = await request('/api/library')
        if (cancelled) return
        if (!response.ok || !body || !Number.isInteger(body.revision)) { setStatus((previous) => ({ ...previous, mode: 'local' })); return }
        const record = readRecord()
        const current = sync.current
        current.base = record?.entries || null
        current.ready = true
        if (body.revision === 0) { await save(stateRef.current, 0); return }
        current.revision = record?.revision || 0
        await reconcile(body)
      } catch {
        if (!cancelled) setStatus((previous) => ({ ...previous, mode: 'local' }))
      }
    })()
    return () => { cancelled = true }
  }, [reconcile, save])

  // Save shortly after each change, and right away when the page is hidden.
  useEffect(() => {
    const current = sync.current
    if (!current.ready || blocked || fingerprint(state) === current.agreed) return
    const timer = window.setTimeout(() => void save(stateRef.current, current.revision), SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state, blocked, save])

  useEffect(() => {
    const visibility = () => {
      const current = sync.current
      if (document.visibilityState === 'hidden') {
        if (current.ready && fingerprint(stateRef.current) !== current.agreed) void save(stateRef.current, current.revision)
      } else void check()
    }
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', visibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('focus', visibility)
    }
  }, [check, save])

  return status
}
