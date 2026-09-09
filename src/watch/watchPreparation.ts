import { localPlaybackBrowser, readWatchState, recentWatch, type Language, type WatchTitle } from './watchState'
import { useEffect, useRef } from 'react'

export function episodePreparation(entry: WatchTitle, episode: number, language: Language) {
  const state = readWatchState()
  const titles = [...new Set([entry.titleEnglish, entry.title, ...(entry.synonyms || [])]
    .filter((title): title is string => !!title && title.trim().length >= 2 && title.length <= 200))].slice(0, 8)
  return { url: state.pages[`${entry.anilistId}:${episode}:${language}`] || state.pages[`${entry.anilistId}:title:${language}`], titles, episode, language, movie: entry.format === 'MOVIE', choose: false }
}

// The server owns this one bounded background job even if a hover ends or the
// chooser unmounts. A subsequent Play request can adopt it without restarting.
export type PreparedSelection = { expiresAt: number; playbackId?: string; language?: Language }
export async function prefetchSelection(entry: WatchTitle, episode: number, language: Language, signal: AbortSignal, intent = false): Promise<PreparedSelection | null> {
  if (readWatchState().sourceTab !== 'wco' || signal.aborted) return null
  const browser = await localPlaybackBrowser()
  const headers = { 'X-WCO-Browser': browser }
  const status = await (await fetch('/api/wco/status', { headers, signal })).json()
  if (!status.available || !status.hiddenPreparation || signal.aborted) return null
  const response = await fetch('/api/wco/prefetch', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ ...episodePreparation(entry, episode, language), ...(intent ? { intent: true } : {}) }),
  })
  if (!response.ok) return null
  const result = await response.json()
  if (!result.ready || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) return null
  return { expiresAt: result.expiresAt, playbackId: typeof result.playbackId === 'string' ? result.playbackId : undefined, language: result.language === 'sub' || result.language === 'dub' ? result.language : undefined }
}

export async function prefetchEpisode(entry: WatchTitle, episode: number, language: Language, signal: AbortSignal, intent = false): Promise<number> {
  return (await prefetchSelection(entry, episode, language, signal, intent))?.expiresAt || 0
}

export function scheduleEpisodePreparation(entry: WatchTitle, episode: number, delay = 250) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => {
    void prefetchEpisode(entry, episode, readWatchState().language, controller.signal, true).catch(() => {})
  }, delay)
  return () => { window.clearTimeout(timer); controller.abort() }
}

// Only a playing video extends its short server-memory lease. The opaque ID is
// never persisted and cannot start a browser or recover an expired source.
export function retainPlayback(playbackId: string, browser: 'chrome' | 'brave', alternateId?: string) {
  let stopped = false
  let timer = 0
  let controller: AbortController | undefined
  const retain = async () => {
    controller = new AbortController()
    const timeout = window.setTimeout(() => controller?.abort(), 5000)
    try {
      const response = await fetch('/api/wco/retain', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WCO-Browser': browser },
        signal: controller.signal, body: JSON.stringify({ playbackId, ...(alternateId && alternateId !== playbackId ? { alternateId } : {}) }),
      })
      if (response.ok && (await response.json()).retained === false) stopped = true
    } catch { /* Playback continues; a later Play can prepare a new source. */ }
    finally { window.clearTimeout(timeout) }
    if (!stopped) timer = window.setTimeout(() => void retain(), 30_000)
  }
  void retain()
  return () => { stopped = true; window.clearTimeout(timer); controller?.abort() }
}

export function useWatchPreparation(entries: WatchTitle[]) {
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  useEffect(() => {
    // A hard refresh preserves only the last stable selection, never a signed
    // URL. Give it a head start while the dashboard renders, without autoplay.
    const last = recentWatch(entriesRef.current)
    if (!last || document.visibilityState === 'hidden') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void prefetchEpisode(last.entry, last.episode, last.language, controller.signal).catch(() => {})
    }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [])
  useEffect(() => {
    let target: HTMLElement | null = null
    let cancel: (() => void) | undefined
    const enter = (event: Event) => {
      const next = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-watch-title]') : null
      if (!next || next === target) return
      cancel?.(); target = next
      const entry = entriesRef.current.find((entry) => entry.id === next.dataset.watchTitle)
      const episode = Number(next.dataset.watchEpisode)
      if (entry && Number.isInteger(episode) && episode > 0) cancel = scheduleEpisodePreparation(entry, episode)
    }
    const leave = (event: Event) => {
      const related = (event as MouseEvent | FocusEvent).relatedTarget
      if (event.target instanceof Node && target?.contains(event.target) && (!(related instanceof Node) || !target.contains(related))) {
        cancel?.(); target = null
      }
    }
    document.addEventListener('pointerover', enter)
    document.addEventListener('pointerout', leave)
    document.addEventListener('focusin', enter)
    document.addEventListener('focusout', leave)
    return () => {
      cancel?.()
      document.removeEventListener('pointerover', enter)
      document.removeEventListener('pointerout', leave)
      document.removeEventListener('focusin', enter)
      document.removeEventListener('focusout', leave)
    }
  }, [])
}
