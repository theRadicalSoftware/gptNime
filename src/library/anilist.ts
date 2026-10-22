import type { AniListMedia, CharacterCredit, ExternalLinkInfo, RankingInfo, RelationInfo, SearchResult, StaffCredit } from './model'

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

export function cleanText(value?: string | null) {
  if (!value) return ''

  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function mapMedia(media: AniListMedia): SearchResult {
  const staff =
    media.staff?.edges
      ?.map((edge) => {
        const node = edge.node
        const name = node?.name?.full
        if (!name) return null

        return {
          id: node.id || undefined,
          name,
          nativeName: node.name?.native || undefined,
          role: edge.role || undefined,
          image: node.image?.large || undefined,
          siteUrl: node.siteUrl || undefined,
          occupations: node.primaryOccupations || undefined,
        }
      })
      .filter(Boolean) as StaffCredit[] | undefined

  const characters =
    media.characters?.edges
      ?.map((edge) => {
        const node = edge.node
        const name = node?.name?.full
        if (!name) return null

        const voiceActorNode = edge.voiceActors?.[0]

        return {
          id: node.id || undefined,
          name,
          nativeName: node.name?.native || undefined,
          role: edge.role || undefined,
          image: node.image?.large || undefined,
          siteUrl: node.siteUrl || undefined,
          voiceActor: voiceActorNode?.name?.full
            ? {
                id: voiceActorNode.id || undefined,
                name: voiceActorNode.name.full,
                nativeName: voiceActorNode.name.native || undefined,
                image: voiceActorNode.image?.large || undefined,
                siteUrl: voiceActorNode.siteUrl || undefined,
              }
            : undefined,
        }
      })
      .filter(Boolean) as CharacterCredit[] | undefined

  const relations =
    media.relations?.edges
      ?.map((edge) => {
        const node = edge.node
        if (!node?.id) return null

        return {
          anilistId: node.id,
          idMal: node.idMal,
          title: node.title?.english || node.title?.romaji || 'Untitled anime',
          relationType: edge.relationType,
          format: node.format,
          releaseStatus: node.status,
          episodesTotal: node.episodes,
          seasonYear: node.seasonYear,
          coverImage: node.coverImage?.large || node.coverImage?.extraLarge || undefined,
        }
      })
      .filter(Boolean) as RelationInfo[] | undefined

  return {
    anilistId: media.id,
    idMal: media.idMal,
    title: media.title?.english || media.title?.romaji || 'Untitled anime',
    titleEnglish: media.title?.english || undefined,
    nativeTitle: media.title?.native || undefined,
    synonyms: [...new Set([media.title?.romaji, ...(media.synonyms || [])].filter((title): title is string => !!title))],
    format: media.format,
    releaseStatus: media.status,
    episodesTotal: media.episodes,
    duration: media.duration,
    description: cleanText(media.description),
    season: media.season,
    seasonYear: media.seasonYear,
    coverImage: media.coverImage?.extraLarge || media.coverImage?.large || undefined,
    bannerImage: media.bannerImage,
    color: media.coverImage?.color,
    genres: media.genres || [],
    tags:
      media.tags
        ?.filter((tag) => tag.name && !tag.isMediaSpoiler)
        .map((tag) => ({
          name: tag.name as string,
          rank: tag.rank,
          isSpoiler: tag.isMediaSpoiler,
        })) || [],
    averageScore: media.averageScore,
    meanScore: media.meanScore,
    popularity: media.popularity,
    favourites: media.favourites,
    source: media.source,
    countryOfOrigin: media.countryOfOrigin,
    hashtag: media.hashtag,
    siteUrl: media.siteUrl,
    trailer: media.trailer,
    studios: media.studios?.nodes?.map((studio) => studio.name).filter(Boolean) as string[] || [],
    staff,
    characters,
    relations,
    externalLinks: media.externalLinks?.filter((link): link is ExternalLinkInfo => Boolean(link?.site && link.url)) || [],
    rankings: media.rankings?.filter((ranking): ranking is RankingInfo => Boolean(ranking?.rank)) || [],
    nextAiringEpisode: media.nextAiringEpisode,
  }
}

export async function postAniList<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`AniList request failed: ${response.status}`)
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join(', '))
  }

  if (!payload.data) {
    throw new Error('AniList returned an empty response')
  }

  return payload.data
}

// The fields a list or season card needs. Details (staff, characters,
// relations) load later, the first time a title is opened.
export const cardMediaFields = `
  id
  idMal
  isAdult
  siteUrl
  title { romaji english native }
  synonyms
  format
  status
  episodes
  duration
  description(asHtml: false)
  season
  seasonYear
  coverImage { extraLarge large color }
  bannerImage
  genres
  tags { name rank isMediaSpoiler }
  averageScore
  meanScore
  popularity
  favourites
  source
  countryOfOrigin
  nextAiringEpisode { episode airingAt timeUntilAiring }
  studios(isMain: true) { nodes { name } }
`

const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
})

// For bulk work (imports, season pages): waits out AniList's rate limit
// instead of failing, and spaces requests so a large list stays polite.
export async function postAniListPatiently<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postAniList<T>(query, variables, signal)
    } catch (error) {
      if (signal?.aborted || attempt >= 3 || !(error instanceof Error) || !/\b429\b|too many/i.test(error.message)) throw error
      await pause(15_000 * (attempt + 1), signal)
    }
  }
}

export function spaceRequests(signal?: AbortSignal) {
  return pause(800, signal)
}
