import { cardMediaFields, mapMedia, postAniListPatiently, spaceRequests } from './anilist'
import type { AniListMedia, AnimeEntry, EntryPriority, SearchResult, WatchStatus } from './model'

// Brings an existing MyAnimeList or AniList history into the ledger. Titles you
// already track keep everything you wrote; an import only moves them forward.
export type ImportedTitle = {
  title: string
  idMal?: number
  media?: SearchResult
  status: WatchStatus
  progress: number
  rating: number | null
  notes: string
  priority: EntryPriority
  rewatching: boolean
  rewatchCount: number
  startedAt?: string
  completedAt?: string
  updatedAt?: string
}

export type ImportPlan = {
  source: string
  added: AnimeEntry[]
  updated: { entry: AnimeEntry; patch: Partial<AnimeEntry> }[]
  unchanged: number
  missing: string[]
}

const malStatuses: Record<string, WatchStatus> = {
  watching: 'watching', '1': 'watching', completed: 'completed', '2': 'completed', 'on-hold': 'paused', '3': 'paused',
  dropped: 'dropped', '4': 'dropped', 'plan to watch': 'planning', '6': 'planning',
}
const aniListStatuses: Record<string, WatchStatus> = { CURRENT: 'watching', PLANNING: 'planning', COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'paused', REPEATING: 'completed' }

function isoDate(year?: number | null, month?: number | null, day?: number | null) {
  if (!year) return undefined
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12))
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function malDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return isoDate(year, month, day)
}

async function fileText(file: File) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  // MyAnimeList hands out its export as a .xml.gz download.
  if (head[0] === 0x1f && head[1] === 0x8b) return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return file.text()
}

export async function readMalExport(file: File): Promise<ImportedTitle[]> {
  const document = new DOMParser().parseFromString(await fileText(file), 'application/xml')
  if (document.querySelector('parsererror') || !document.querySelector('myanimelist')) throw new Error('Choose the animelist .xml or .xml.gz file from MyAnimeList’s export page.')
  return Array.from(document.querySelectorAll('myanimelist > anime')).map((node): ImportedTitle => {
    const text = (tag: string) => node.querySelector(tag)?.textContent?.trim() || ''
    const status = malStatuses[text('my_status').toLowerCase()] || 'planning'
    const score = Number(text('my_score'))
    return {
      title: text('series_title') || 'Untitled anime',
      idMal: Number(text('series_animedb_id')) || undefined,
      status,
      progress: Math.max(0, Math.floor(Number(text('my_watched_episodes')) || 0)),
      rating: score > 0 ? Math.min(10, score) : null,
      notes: text('my_comments'),
      // MyAnimeList marks every title Low unless it was raised.
      priority: text('my_priority').toUpperCase() === 'HIGH' ? 'high' : 'normal',
      rewatching: text('my_rewatching') === '1',
      rewatchCount: Math.max(0, Number(text('my_times_watched')) || 0),
      startedAt: malDate(text('my_start_date')),
      completedAt: malDate(text('my_finish_date')),
    }
  }).filter((item) => item.idMal)
}

const malMediaQuery = `
query ImportByMal($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    media(idMal_in: $ids, type: ANIME) { ${cardMediaFields} }
  }
}
`

// MyAnimeList exports carry MAL ids only; AniList supplies covers and details.
export async function attachMedia(titles: ImportedTitle[], onProgress: (done: number) => void, signal?: AbortSignal) {
  const pending = titles.filter((title) => !title.media && title.idMal)
  for (let index = 0; index < pending.length; index += 50) {
    if (index) await spaceRequests(signal)
    const batch = pending.slice(index, index + 50)
    const data = await postAniListPatiently<{ Page: { media: AniListMedia[] } }>(malMediaQuery, { ids: batch.map((title) => title.idMal), page: 1 }, signal)
    const byMal = new Map(data.Page.media.filter((media) => media.idMal).map((media) => [media.idMal!, mapMedia(media)]))
    batch.forEach((title) => { title.media = byMal.get(title.idMal!) })
    onProgress(Math.min(pending.length, index + batch.length))
  }
  return titles
}

const aniListUserQuery = `
query ImportUser($name: String) {
  MediaListCollection(userName: $name, type: ANIME) {
    lists {
      entries {
        status
        progress
        score(format: POINT_10_DECIMAL)
        repeat
        notes
        updatedAt
        startedAt { year month day }
        completedAt { year month day }
        media { ${cardMediaFields} }
      }
    }
  }
}
`

type AniListListEntry = {
  status?: string | null; progress?: number | null; score?: number | null; repeat?: number | null; notes?: string | null; updatedAt?: number | null
  startedAt?: { year?: number | null; month?: number | null; day?: number | null } | null
  completedAt?: { year?: number | null; month?: number | null; day?: number | null } | null
  media?: AniListMedia | null
}

export async function readAniListUser(name: string, signal?: AbortSignal): Promise<ImportedTitle[]> {
  const userName = name.trim().replace(/^@/, '').replace(/^https?:\/\/anilist\.co\/user\/([^/]+).*$/i, '$1')
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(userName)) throw new Error('Enter an AniList username, like the one in anilist.co/user/…')
  let data: { MediaListCollection?: { lists?: { entries?: AniListListEntry[] | null }[] | null } | null }
  try {
    data = await postAniListPatiently(aniListUserQuery, { name: userName }, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    const message = error instanceof Error ? error.message : ''
    throw new Error(/private/i.test(message) ? 'That AniList list is private. Make it public for a moment, or use a MyAnimeList export.' : /not found|404/i.test(message) ? 'No AniList user has that name.' : 'AniList could not be reached. Try again in a minute.')
  }
  const seen = new Set<number>()
  return (data.MediaListCollection?.lists || []).flatMap((list) => list.entries || []).flatMap((item) => {
    if (!item.media || item.media.isAdult || seen.has(item.media.id)) return []
    seen.add(item.media.id)
    const media = mapMedia(item.media)
    return [{
      title: media.title,
      idMal: media.idMal || undefined,
      media,
      status: aniListStatuses[item.status || ''] || 'planning',
      progress: Math.max(0, item.progress || 0),
      rating: item.score ? Math.min(10, item.score) : null,
      notes: item.notes?.trim() || '',
      priority: 'normal' as const,
      rewatching: item.status === 'REPEATING',
      rewatchCount: Math.max(0, item.repeat || 0),
      startedAt: isoDate(item.startedAt?.year, item.startedAt?.month, item.startedAt?.day),
      completedAt: isoDate(item.completedAt?.year, item.completedAt?.month, item.completedAt?.day),
      updatedAt: item.updatedAt ? new Date(item.updatedAt * 1000).toISOString() : undefined,
    }]
  })
}

export function planImport(library: AnimeEntry[], titles: ImportedTitle[], source: string, createId: () => string): ImportPlan {
  const tracked = new Map(library.map((entry) => [entry.anilistId, entry]))
  const now = new Date().toISOString()
  const plan: ImportPlan = { source, added: [], updated: [], unchanged: 0, missing: [] }
  const planned = new Set<number>()
  for (const title of titles) {
    const media = title.media
    if (!media) { plan.missing.push(title.title); continue }
    if (planned.has(media.anilistId)) continue
    planned.add(media.anilistId)
    const completed = title.status === 'completed'
    const progress = completed && media.episodesTotal ? media.episodesTotal : media.episodesTotal ? Math.min(media.episodesTotal, title.progress) : title.progress
    const existing = tracked.get(media.anilistId)
    if (!existing) {
      const watched = title.completedAt || title.updatedAt
      plan.added.push({
        ...media,
        id: createId(),
        status: title.status,
        progress,
        rating: title.rating,
        notes: title.notes,
        priority: title.priority,
        addedAt: now,
        updatedAt: now,
        startedAt: title.startedAt || (progress ? watched : undefined),
        completedAt: completed ? title.completedAt || title.updatedAt || now : undefined,
        lastWatchedAt: progress ? watched : undefined,
        rewatchStatus: title.rewatching ? 'rewatching' : 'none',
        rewatchStartedAt: title.rewatching ? title.updatedAt || now : undefined,
        rewatchCount: title.rewatchCount,
      })
      continue
    }
    // Only move a tracked title forward, and only fill what is still empty.
    const patch: Partial<AnimeEntry> = {}
    if (progress > existing.progress) { patch.progress = progress; patch.lastWatchedAt = title.completedAt || title.updatedAt || now }
    if (completed && existing.status !== 'completed') { patch.status = 'completed'; patch.completedAt = title.completedAt || now }
    else if (existing.status === 'planning' && title.status !== 'planning' && progress > existing.progress) patch.status = title.status
    if (existing.rating === null && title.rating !== null) patch.rating = title.rating
    if (!existing.notes.trim() && title.notes) patch.notes = title.notes
    if (Object.keys(patch).length) plan.updated.push({ entry: existing, patch })
    else plan.unchanged++
  }
  return plan
}
