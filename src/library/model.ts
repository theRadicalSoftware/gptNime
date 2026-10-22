// The stored anime ledger and the AniList shapes it is built from.

export type WatchStatus = 'watching' | 'planning' | 'completed' | 'paused' | 'dropped'

export type RewatchStatus = 'none' | 'planned' | 'rewatching'

export type EntryPriority = 'low' | 'normal' | 'high'

export type AiringInfo = {
  episode: number
  airingAt: number
  timeUntilAiring?: number | null
}

export type StaffCredit = {
  id?: number
  name: string
  nativeName?: string
  role?: string
  image?: string
  siteUrl?: string
  occupations?: string[]
}

export type CharacterCredit = {
  id?: number
  name: string
  nativeName?: string
  role?: string
  image?: string
  siteUrl?: string
  voiceActor?: StaffCredit
}

export type RelationInfo = {
  anilistId: number
  idMal?: number | null
  title: string
  relationType?: string | null
  format?: string | null
  releaseStatus?: string | null
  episodesTotal?: number | null
  seasonYear?: number | null
  coverImage?: string
}

export type ExternalLinkInfo = {
  site: string
  url: string
  icon?: string | null
  color?: string | null
  type?: string | null
}

export type TagInfo = {
  name: string
  rank?: number | null
  isSpoiler?: boolean | null
}

export type RankingInfo = {
  rank: number
  type?: string | null
  season?: string | null
  year?: number | null
  allTime?: boolean | null
  context?: string | null
}

export type EpisodeInfo = {
  number: number
  title: string
  titleJapanese?: string
  titleRomanji?: string
  aired?: string | null
  score?: number | null
  filler?: boolean
  recap?: boolean
  url?: string
}

export type SearchResult = {
  anilistId: number
  idMal?: number | null
  title: string
  titleEnglish?: string
  nativeTitle?: string
  synonyms?: string[]
  format?: string | null
  releaseStatus?: string | null
  episodesTotal?: number | null
  duration?: number | null
  description?: string
  season?: string | null
  seasonYear?: number | null
  coverImage?: string
  bannerImage?: string | null
  color?: string | null
  genres: string[]
  tags?: TagInfo[]
  averageScore?: number | null
  meanScore?: number | null
  popularity?: number | null
  favourites?: number | null
  source?: string | null
  countryOfOrigin?: string | null
  hashtag?: string | null
  siteUrl?: string | null
  trailer?: {
    id?: string | null
    site?: string | null
    thumbnail?: string | null
  } | null
  studios: string[]
  staff?: StaffCredit[]
  characters?: CharacterCredit[]
  relations?: RelationInfo[]
  externalLinks?: ExternalLinkInfo[]
  rankings?: RankingInfo[]
  nextAiringEpisode?: AiringInfo | null
}

export type AnimeEntry = SearchResult & {
  id: string
  status: WatchStatus
  progress: number
  rating: number | null
  notes: string
  episodeMemo?: string
  addedAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  lastWatchedAt?: string
  rewatchStatus?: RewatchStatus
  rewatchPlannedAt?: string
  rewatchStartedAt?: string
  rewatchCount?: number
  episodeList?: EpisodeInfo[]
  episodeListLoaded?: boolean
  episodeListError?: string
  detailsLoaded?: boolean
  detailsUpdatedAt?: string
  favorite?: boolean
  rewatchWorthy?: boolean
  priority?: EntryPriority
  droppedReason?: string
}

export type HistoryEventType = 'added' | 'progress' | 'rating' | 'status' | 'note' | 'removed' | 'import' | 'refresh' | 'rewatch' | 'label'

export type HistoryEvent = {
  id: string
  animeId?: string
  animeTitle: string
  type: HistoryEventType
  message: string
  at: string
}

export type StoredState = {
  library: AnimeEntry[]
  history: HistoryEvent[]
}

export type AniListMedia = {
  id: number
  idMal?: number | null
  isAdult?: boolean | null
  siteUrl?: string | null
  title?: {
    romaji?: string | null
    english?: string | null
    native?: string | null
  }
  format?: string | null
  status?: string | null
  episodes?: number | null
  duration?: number | null
  description?: string | null
  synonyms?: string[] | null
  season?: string | null
  seasonYear?: number | null
  coverImage?: {
    extraLarge?: string | null
    large?: string | null
    color?: string | null
  } | null
  bannerImage?: string | null
  genres?: string[] | null
  tags?: Array<{ name?: string | null; rank?: number | null; isMediaSpoiler?: boolean | null }> | null
  averageScore?: number | null
  meanScore?: number | null
  popularity?: number | null
  favourites?: number | null
  source?: string | null
  countryOfOrigin?: string | null
  hashtag?: string | null
  trailer?: {
    id?: string | null
    site?: string | null
    thumbnail?: string | null
  } | null
  nextAiringEpisode?: AiringInfo | null
  studios?: {
    nodes?: Array<{ id?: number | null; name?: string | null; siteUrl?: string | null }> | null
  } | null
  staff?: {
    edges?: Array<{
      role?: string | null
      node?: {
        id?: number | null
        name?: { full?: string | null; native?: string | null } | null
        image?: { large?: string | null } | null
        siteUrl?: string | null
        primaryOccupations?: string[] | null
      } | null
    }> | null
  } | null
  characters?: {
    edges?: Array<{
      role?: string | null
      node?: {
        id?: number | null
        name?: { full?: string | null; native?: string | null } | null
        image?: { large?: string | null } | null
        siteUrl?: string | null
      } | null
      voiceActors?: Array<{
        id?: number | null
        name?: { full?: string | null; native?: string | null } | null
        image?: { large?: string | null } | null
        siteUrl?: string | null
      }> | null
    }> | null
  } | null
  relations?: {
    edges?: Array<{
      relationType?: string | null
      node?: AniListMedia | null
    }> | null
  } | null
  externalLinks?: Array<ExternalLinkInfo | null> | null
  rankings?: Array<RankingInfo | null> | null
}

export type AniListRecommendationNode = {
  rating?: number | null
  mediaRecommendation?: AniListMedia | null
}

export type RecommendedAnime = SearchResult & {
  recommendationScore: number
  recommendedFrom: string[]
}
