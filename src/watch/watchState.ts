export type WatchTitle = {
  id: string
  anilistId: number
  title: string
  titleEnglish?: string
  synonyms?: string[]
  format?: string | null
  coverImage?: string
  bannerImage?: string
  progress: number
  episodesTotal?: number | null
  status: string
  episodeList?: { number: number; title: string }[]
  externalLinks?: { site: string; url: string; type?: string | null }[]
}

export type WatchRequest = { id: string; episode?: number; serial: number }
export type Language = 'sub' | 'dub'
export async function localPlaybackBrowser(): Promise<'chrome' | 'brave'> {
  const browserNavigator = navigator as Navigator & { brave?: { isBrave: () => Promise<boolean> } }
  try { if (await browserNavigator.brave?.isBrave()) return 'brave' } catch { /* Use the default installed browser. */ }
  return 'chrome'
}
type Bookmark = { time: number; duration: number; updatedAt: number }
type LastWatch = { anilistId: number; episode: number; language: Language; updatedAt: number; finished: boolean }
type WatchState = {
  language: Language
  sourceTab: 'wco' | 'file' | 'url'
  autoMark: boolean
  pages: Record<string, string>
  bookmarks: Record<string, Bookmark>
  lastWatch?: LastWatch
}

export const WATCH_STORAGE_KEY = 'gptnime-cinema-v1'
export const WCO_SEARCH = 'https://www.wco.tv/search'
export const WCO_CATALOGUES = {
  sub: 'https://www.wco.tv/subbed-anime-list',
  dub: 'https://www.wco.tv/dubbed-anime-list',
  movies: 'https://www.wco.tv/movie-list',
}
const pageHosts = new Set([
  'wco.tv', 'wcostream.tv', 'wcoanimedub.tv', 'wcoanimesub.tv',
  'wcofun.net', 'wcoforever.net', 'wcoflix.tv', 'wcopremium.tv',
])

export function wcoPage(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if (!pageHosts.has(url.hostname.replace(/^www\./, ''))) return null
    if (/\.(php|mp4|m3u8|flv)$|\/getvid|\/inc\//i.test(url.pathname)) return null
    // Only catalogue pages are durable. Player credentials are never stored.
    if (['evid', 'file', 'h', 'n', 'token'].some((key) => url.searchParams.has(key))) return null
    return url.href
  } catch { return null }
}

export function mediaUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
    // Catalogue pages belong in the provider tab. A CDN hostname alone does not
    // establish that its media is unplayable: let normal browser delivery decide.
    if (pageHosts.has(url.hostname.replace(/^www\./, ''))) return null
    return url.href
  } catch { return null }
}

export function firstEpisode(entry: WatchTitle): number {
  if (entry.format === 'MOVIE' || (entry.episodesTotal && entry.progress >= entry.episodesTotal)) return 1
  return Math.max(1, entry.progress + 1)
}

export function recentWatch(entries: WatchTitle[]) {
  const state = readWatchState()
  const last = state.lastWatch
  if (state.sourceTab !== 'wco' || !last || last.finished || Date.now() - last.updatedAt > 24 * 60 * 60_000) return null
  const entry = entries.find((entry) => entry.anilistId === last.anilistId)
  if (!entry || (entry.episodesTotal && last.episode > entry.episodesTotal) || (entry.format === 'MOVIE' && last.episode !== 1)) return null
  return { entry, episode: last.episode, language: state.language }
}

export function episodeLabel(entry: WatchTitle, episode: number): string {
  return entry.format === 'MOVIE' ? 'Feature film' : `Episode ${episode}`
}

export function clockLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const minutes = Math.floor(safe / 60)
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:` : ''}${minutes >= 60 ? String(minutes % 60).padStart(2, '0') : minutes}:${String(safe % 60).padStart(2, '0')}`
}

export function sourceFingerprint(value: string): string {
  // A compact identity for resume points; never persist signed media URLs.
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}

export function readWatchState(): WatchState {
  const empty: WatchState = { language: 'sub', sourceTab: 'wco', autoMark: true, pages: {}, bookmarks: {} }
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return empty
    const pages = Object.fromEntries(Object.entries(raw.pages || {}).filter(([key, value]) =>
      /^\d+:(title|\d+):(sub|dub)$/.test(key) && typeof value === 'string' && wcoPage(value),
    )) as Record<string, string>
    const bookmarks = Object.fromEntries(Object.entries(raw.bookmarks || {}).filter(([, value]) => {
      const item = value as Bookmark
      return item && Number.isFinite(item.time) && item.time >= 0 && Number.isFinite(item.duration) && item.duration > 0 && Number.isFinite(item.updatedAt)
    }).sort((a, b) => (b[1] as Bookmark).updatedAt - (a[1] as Bookmark).updatedAt).slice(0, 200)) as Record<string, Bookmark>
    const last = raw.lastWatch
    const lastWatch: LastWatch | undefined = last && Number.isInteger(last.anilistId) && last.anilistId > 0 && Number.isInteger(last.episode) && last.episode > 0 && last.episode <= 100_000 && ['sub', 'dub'].includes(last.language) && Number.isFinite(last.updatedAt) && last.updatedAt <= Date.now() && typeof last.finished === 'boolean'
      ? { anilistId: last.anilistId, episode: last.episode, language: last.language, updatedAt: last.updatedAt, finished: last.finished } : undefined
    return { language: raw.language === 'dub' ? 'dub' : 'sub', sourceTab: raw.sourceTab === 'file' || raw.sourceTab === 'url' ? raw.sourceTab : 'wco', autoMark: raw.autoMark !== false, pages, bookmarks, lastWatch }
  } catch { return empty }
}

export function writeWatchState(state: WatchState): boolean {
  try {
    const bookmarks = Object.fromEntries(Object.entries(state.bookmarks).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 200))
    localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify({ ...state, bookmarks }))
    return true
  } catch { return false }
}
