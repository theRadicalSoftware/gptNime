import { localPlaybackBrowser, readWatchState, type Language, type WatchTitle } from './watchState'
import { useEffect, useRef } from 'react'

export function episodePreparation(entry: WatchTitle, episode: number, language: Language) {
  const state = readWatchState()
  const titles = [...new Set([entry.titleEnglish, entry.title, ...(entry.synonyms || [])]
    .filter((title): title is string => !!title && title.trim().length >= 2 && title.length <= 200))].slice(0, 8)
  return { url: state.pages[`${entry.anilistId}:${episode}:${language}`] || state.pages[`${entry.anilistId}:title:${language}`], titles, episode, language, movie: entry.format === 'MOVIE', choose: false }
}

// The server owns this one bounded background job even if a hover ends or the
// chooser unmounts. A subsequent Play request can adopt it without restarting.
export async function prefetchEpisode(entry: WatchTitle, episode: number, language: Language, signal: AbortSignal): Promise<number> {
  if (readWatchState().sourceTab !== 'wco' || signal.aborted) return 0
  const browser = await localPlaybackBrowser()
  const headers = { 'X-WCO-Browser': browser }
  const status = await (await fetch('/api/wco/status', { headers, signal })).json()
  if (!status.available || !status.hiddenPreparation || signal.aborted) return 0
  const response = await fetch('/api/wco/prefetch', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify(episodePreparation(entry, episode, language)),
  })
  if (!response.ok) return 0
  const result = await response.json()
  return result.ready && Number.isFinite(result.expiresAt) && result.expiresAt > Date.now() ? result.expiresAt : 0
}

export function scheduleEpisodePreparation(entry: WatchTitle, episode: number, delay = 700) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => {
    void prefetchEpisode(entry, episode, readWatchState().language, controller.signal).catch(() => {})
  }, delay)
  return () => { window.clearTimeout(timer); controller.abort() }
}

export function useWatchPreparation(entries: WatchTitle[]) {
  const entriesRef = useRef(entries)
  entriesRef.current = entries
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
