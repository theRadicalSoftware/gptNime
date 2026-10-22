import { cardMediaFields, mapMedia, postAniListPatiently, spaceRequests } from './anilist'
import type { AniListMedia, AnimeEntry, SearchResult } from './model'

// The new season, ordered by how well each show fits what this library loves:
// genres, themes and studios from titles you rated, finished, favorited or
// rewatched, with dropped and low-rated titles counting against.
export type SeasonName = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
export type SeasonKey = { season: SeasonName; year: number }
export type SeasonShow = SearchResult & { prequelIds: number[] }
export type SeasonPick = SeasonShow & { match: number | null; reasons: string[]; continues?: AnimeEntry }

const order: SeasonName[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const cache = new Map<string, Promise<SeasonShow[]>>()

export function seasonOf(date: Date): SeasonKey {
  return { season: order[Math.floor(date.getMonth() / 3)], year: date.getFullYear() }
}

export function shiftSeason({ season, year }: SeasonKey, delta: number): SeasonKey {
  const index = order.indexOf(season) + delta
  return { season: order[((index % 4) + 4) % 4], year: year + Math.floor(index / 4) }
}

export function seasonLabel({ season, year }: SeasonKey) {
  return `${season[0]}${season.slice(1).toLowerCase()} ${year}`
}

const seasonQuery = `
query SeasonLineup($season: MediaSeason, $year: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
      ${cardMediaFields}
      relations { edges { relationType node { id type } } }
    }
  }
}
`

type SeasonPage = { Page: { pageInfo?: { hasNextPage?: boolean | null } | null; media: (Omit<AniListMedia, 'relations'> & { relations?: { edges?: { relationType?: string | null; node?: { id: number; type?: string | null } | null }[] | null } | null })[] } }

// The season's 100 most popular shows: the lineup people actually talk about.
// One shared request per season; leaving the page does not cancel it.
export function fetchSeason(key: SeasonKey): Promise<SeasonShow[]> {
  const id = `${key.season}:${key.year}`
  const known = cache.get(id)
  if (known) return known
  const work = (async () => {
    const shows: SeasonShow[] = []
    for (let page = 1; page <= 2; page++) {
      if (page > 1) await spaceRequests()
      const data = await postAniListPatiently<SeasonPage>(seasonQuery, { season: key.season, year: key.year, page })
      for (const media of data.Page.media) {
        if (media.isAdult) continue
        const prequelIds = (media.relations?.edges || []).filter((edge) => edge.relationType === 'PREQUEL' && edge.node?.type === 'ANIME').map((edge) => edge.node!.id)
        shows.push({ ...mapMedia({ ...media, relations: null }), prequelIds })
      }
      if (!data.Page.pageInfo?.hasNextPage) break
    }
    return shows
  })()
  cache.set(id, work)
  work.catch(() => cache.delete(id))
  return work
}

type Taste = { genres: Map<string, number>; tags: Map<string, number>; studios: Map<string, number>; genreScale: number; tagScale: number; studioScale: number }

function add(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) || 0) + value)
}

function scale(map: Map<string, number>, count: number) {
  return [...map.values()].filter((value) => value > 0).sort((a, b) => b - a).slice(0, count).reduce((sum, value) => sum + value, 0) || 1
}

export function tasteOf(library: AnimeEntry[], signalFor: (entry: AnimeEntry) => number): Taste | null {
  const taste: Taste = { genres: new Map(), tags: new Map(), studios: new Map(), genreScale: 1, tagScale: 1, studioScale: 1 }
  let signals = 0
  for (const entry of library) {
    const signal = signalFor(entry)
    if (!signal) continue
    if (signal > 0) signals++
    const weight = Math.max(-1, Math.min(2, signal / 100))
    entry.genres.forEach((genre) => add(taste.genres, genre, weight))
    entry.tags?.forEach((tag) => { if (!tag.isSpoiler && (tag.rank || 0) >= 50) add(taste.tags, tag.name, weight * (tag.rank || 0) / 100) })
    entry.studios.forEach((studio) => add(taste.studios, studio, weight))
  }
  if (!signals) return null
  taste.genreScale = scale(taste.genres, 3)
  taste.tagScale = scale(taste.tags, 5)
  taste.studioScale = Math.max(1, ...taste.studios.values())
  return taste
}

export function rankSeason(shows: SeasonShow[], library: AnimeEntry[], taste: Taste | null): SeasonPick[] {
  const tracked = new Map(library.map((entry) => [entry.anilistId, entry]))
  return shows.map((show, popularity) => {
    const continues = show.prequelIds.map((id) => tracked.get(id)).find((entry) => entry && entry.status !== 'dropped')
    if (!taste) return { ...show, match: null, reasons: [], continues }
    const genres = show.genres.map((genre) => [genre, taste.genres.get(genre) || 0] as const)
    const tags = (show.tags || []).filter((tag) => (tag.rank || 0) >= 40).map((tag) => [tag.name, (taste.tags.get(tag.name) || 0) * (tag.rank || 0) / 100] as const)
    const studio = Math.max(0, ...show.studios.map((name) => taste.studios.get(name) || 0))
    const genreFit = Math.max(-0.5, Math.min(1, genres.reduce((sum, [, value]) => sum + value, 0) / taste.genreScale))
    const tagFit = Math.max(-0.5, Math.min(1, tags.reduce((sum, [, value]) => sum + value, 0) / taste.tagScale))
    const quality = (show.averageScore || show.meanScore || 62) / 100
    const fit = 0.42 * genreFit + 0.3 * tagFit + 0.12 * (studio / taste.studioScale) + 0.16 * quality + (continues ? 0.25 : 0)
    const liked = [...genres, ...tags].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
    const reasons = [
      ...(liked.length ? [`You like ${liked.join(', ')}`] : []),
      ...(studio / taste.studioScale >= 0.5 ? [`From ${show.studios.find((name) => (taste.studios.get(name) || 0) === studio)}`] : []),
    ]
    // Popularity breaks ties, so equal fits keep the season's own order.
    return { ...show, match: Math.round(Math.max(1, Math.min(99, fit * 100))) - popularity / 1000, reasons, continues }
  }).sort((first, second) => (second.match ?? 0) - (first.match ?? 0))
    .map((pick) => ({ ...pick, match: pick.match === null ? null : Math.round(pick.match) }))
}
