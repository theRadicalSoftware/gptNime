import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArchiveRestore, FileUp, Loader2, ShieldAlert, ShieldCheck, UserRound, X } from 'lucide-react'
import { listBackups, type BackupInfo, type HomeCopyStatus } from './homeCopy'
import { attachMedia, planImport, readAniListUser, readMalExport, type ImportPlan, type ImportedTitle } from './listImport'
import type { AnimeEntry } from './model'
import './LibraryVault.css'

type Props = {
  status: HomeCopyStatus
  library: AnimeEntry[]
  createId: () => string
  onRestore: (backup: BackupInfo) => Promise<void>
  onImport: (plan: ImportPlan) => void
  close: () => void
}

const dayLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
const clock = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''

function protectionLine(status: HomeCopyStatus) {
  switch (status.mode) {
    case 'saved': return `Saved on this computer${status.savedAt ? ` at ${clock(status.savedAt)}` : ''}. A phone or another browser opens this same library.`
    case 'saving': return 'Saving to this computer…'
    case 'offline': return 'This computer’s copy is out of reach right now. Changes stay in this browser and are saved there once it is back.'
    case 'local': return 'Saved in this browser only. Start GPTNime from its launcher to keep a copy and daily backups on this computer.'
    default: return 'Checking this computer’s copy…'
  }
}

export default function LibraryVault({ status, library, createId, onRestore, onImport, close }: Props) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [backupError, setBackupError] = useState('')
  const [restoring, setRestoring] = useState('')
  const [userName, setUserName] = useState('')
  const [work, setWork] = useState<{ label: string; done?: number; total?: number } | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [importError, setImportError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const protectedHere = status.mode === 'saved' || status.mode === 'saving'

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (status.mode === 'local' || status.mode === 'checking') return
    let cancelled = false
    listBackups().then((list) => { if (!cancelled) setBackups(list) }, (error) => { if (!cancelled) setBackupError(error.message) })
    return () => { cancelled = true }
  }, [status.mode])

  const prepare = async (source: string, read: (signal: AbortSignal) => Promise<ImportedTitle[]>) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPlan(null); setImportError(''); setWork({ label: `Reading ${source}…` })
    try {
      const titles = await read(controller.signal)
      if (!titles.length) throw new Error(`No anime were found in that ${source} list.`)
      const unmatched = titles.filter((title) => !title.media).length
      if (unmatched) setWork({ label: 'Matching titles on AniList…', done: 0, total: unmatched })
      await attachMedia(titles, (done) => setWork({ label: 'Matching titles on AniList…', done, total: unmatched }), controller.signal)
      if (!controller.signal.aborted) setPlan(planImport(library, titles, source, createId))
    } catch (error) {
      if (!controller.signal.aborted) setImportError(error instanceof Error ? error.message : `That ${source} list could not be read.`)
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setWork(null) }
    }
  }

  const restore = async (backup: BackupInfo) => {
    setRestoring(backup.date); setBackupError('')
    try { await onRestore(backup) } catch (error) { setBackupError(error instanceof Error ? error.message : 'That backup could not be opened.') } finally { setRestoring('') }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}>
      <motion.article className="import-modal vault-modal" role="dialog" aria-modal="true" aria-label="Library and backups"
        initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="import-modal-header">
          <div>
            <p className="eyebrow">Library and backups</p>
            <h2>{library.length} title{library.length === 1 ? '' : 's'} in your ledger</h2>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={close}><X size={18} /></button>
        </div>

        <section className={`vault-protection${protectedHere ? ' is-protected' : ''}`}>
          {protectedHere ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
          <div>
            <p>{protectionLine(status)}</p>
            {status.persisted !== null && <p className="vault-quiet">{status.persisted ? 'This browser keeps GPTNime’s storage through its cleanups.' : 'This browser may clear storage when space runs low; the computer’s copy covers that.'}</p>}
          </div>
        </section>

        {status.mode !== 'local' && status.mode !== 'checking' && <section className="vault-section">
          <h3>Daily backups</h3>
          <p className="vault-quiet">Each day keeps the library as it stood before that day’s first change; the last 30 days stay on this computer, readable only by your account.</p>
          {backupError && <p className="notice notice-error">{backupError}</p>}
          {backups === null && !backupError && <p className="vault-quiet"><Loader2 className="spin" size={13} /> Loading backups…</p>}
          {backups?.length === 0 && <p className="vault-quiet">The first backup is made with your first change today.</p>}
          {!!backups?.length && <ul className="vault-backups">
            {backups.map((backup) => <li key={backup.date}>
              <span><strong>{dayLabel(backup.date)}</strong>{backup.titles ? ` · ${backup.titles} title${backup.titles === 1 ? '' : 's'}` : ''}</span>
              <button className="mini-button" type="button" disabled={!!restoring} onClick={() => void restore(backup)}>{restoring === backup.date ? <Loader2 className="spin" size={14} /> : <ArchiveRestore size={14} />}<span>Restore…</span></button>
            </li>)}
          </ul>}
        </section>}

        <section className="vault-section">
          <h3>Bring in your history</h3>
          <div className="vault-import-grid">
            <div className="import-mode-card vault-source">
              <strong>MyAnimeList</strong>
              <span>Export your anime list from <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noopener noreferrer">MyAnimeList’s export page</a>, then choose the downloaded file.</span>
              <button className="mini-button" type="button" disabled={!!work} onClick={() => fileRef.current?.click()}><FileUp size={14} /><span>Choose export file</span></button>
              <input ref={fileRef} className="hidden-file" type="file" accept=".xml,.gz,application/xml,application/gzip,text/xml" aria-label="MyAnimeList export file" onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void prepare('MyAnimeList', () => readMalExport(file))
              }} />
            </div>
            <form className="import-mode-card vault-source" onSubmit={(event) => { event.preventDefault(); void prepare('AniList', (signal) => readAniListUser(userName, signal)) }}>
              <strong>AniList</strong>
              <span>Enter a public AniList username. Nothing is signed in or sent anywhere else.</span>
              <span className="vault-user">
                <input aria-label="AniList username" value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Username" autoComplete="off" spellCheck={false} />
                <button className="mini-button" type="submit" disabled={!!work || userName.trim().length < 2}><UserRound size={14} /><span>Import</span></button>
              </span>
            </form>
          </div>
          {work && <p className="notice notice-live vault-work"><Loader2 className="spin" size={14} />{work.label}{work.total ? ` ${work.done || 0} of ${work.total}` : ''}<button className="mini-button" type="button" onClick={() => abortRef.current?.abort()}>Cancel</button></p>}
          {importError && <p className="notice notice-error">{importError}</p>}
          {plan && <div className="vault-plan">
            <div className="import-summary-grid">
              <div className="metric"><span>New</span><strong>{plan.added.length}</strong></div>
              <div className="metric"><span>Moved forward</span><strong>{plan.updated.length}</strong></div>
              <div className="metric"><span>Already up to date</span><strong>{plan.unchanged}</strong></div>
            </div>
            <p className="vault-quiet">Titles you already track keep your notes, scores and status; an import only adds progress, a finished status, or a score or note you hadn’t set.{plan.missing.length ? ` ${plan.missing.length} title${plan.missing.length === 1 ? ' was' : 's were'} not found on AniList: ${plan.missing.slice(0, 3).join(', ')}${plan.missing.length > 3 ? '…' : ''}` : ''}</p>
            <div className="import-modal-actions">
              <button className="icon-text-button" type="button" onClick={() => setPlan(null)}><X size={16} /><span>Cancel</span></button>
              <button className="icon-text-button strong" type="button" disabled={!plan.added.length && !plan.updated.length} onClick={() => { onImport(plan); setPlan(null) }}><FileUp size={16} /><span>Add to my library</span></button>
            </div>
          </div>}
        </section>
      </motion.article>
    </motion.div>
  )
}
