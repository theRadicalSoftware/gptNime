import type { ChangeEvent, CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Clock3,
  Download,
  Eye,
  Flame,
  History,
  Import,
  Info,
  LibraryBig,
  Link,
  ListFilter,
  Loader2,
  Maximize2,
  Minus,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import './App.css'

const STORAGE_KEY = 'gptnime-tracker-library-v1'
const FOCUS_LAYOUT_KEY = 'gptnime-focus-layout-v1'
const NOTIFICATION_PREFS_KEY = 'gptnime-notification-prefs-v1'
const ANILIST_ENDPOINT = 'https://graphql.anilist.co'
const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4'
const LIVE_SEARCH_DELAY_MS = 340
const MIN_SEARCH_LENGTH = 2
const JIKAN_PAGE_DELAY_MS = 360

type WatchStatus = 'watching' | 'planning' | 'completed' | 'paused' | 'dropped'
type RewatchStatus = 'none' | 'planned' | 'rewatching'
type ViewName = 'dashboard' | 'library' | 'upcoming' | 'history'
type SortMode = 'recent' | 'title' | 'rating' | 'progress'
type LibraryFilter = WatchStatus | 'all' | 'rewatch' | 'rewatching'
type EntryPriority = 'low' | 'normal' | 'high'
type ImportMode = 'merge' | 'replace'
type FocusLayout = 'cinematic' | 'compact'
type CollectionBadgeId = 'franchise-master' | 'movie-night' | 'rewatch-pick' | 'high-priority' | 'left-hanging'
type AmbientSeason = 'winter' | 'spring' | 'summer' | 'fall'

type AiringInfo = {
  episode: number
  airingAt: number
  timeUntilAiring?: number | null
}

type StaffCredit = {
  id?: number
  name: string
  nativeName?: string
  role?: string
  image?: string
  siteUrl?: string
  occupations?: string[]
}

type CharacterCredit = {
  id?: number
  name: string
  nativeName?: string
  role?: string
  image?: string
  siteUrl?: string
  voiceActor?: StaffCredit
}

type RelationInfo = {
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

type ExternalLinkInfo = {
  site: string
  url: string
  icon?: string | null
  color?: string | null
  type?: string | null
}

type TagInfo = {
  name: string
  rank?: number | null
  isSpoiler?: boolean | null
}

type RankingInfo = {
  rank: number
  type?: string | null
  season?: string | null
  year?: number | null
  allTime?: boolean | null
  context?: string | null
}

type EpisodeInfo = {
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

type SearchResult = {
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

type AnimeEntry = SearchResult & {
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

type HistoryEventType = 'added' | 'progress' | 'rating' | 'status' | 'note' | 'removed' | 'import' | 'refresh' | 'rewatch' | 'label'

type HistoryEvent = {
  id: string
  animeId?: string
  animeTitle: string
  type: HistoryEventType
  message: string
  at: string
}

type StoredState = {
  library: AnimeEntry[]
  history: HistoryEvent[]
}

type NotificationPreferences = {
  staleDays: number
  onlyWatching: boolean
  onlyHighPriority: boolean
  mutedAnimeIds: string[]
  dismissedNotificationIds: string[]
  snoozedUntilById: Record<string, string>
}

type LibraryGroup = {
  id: string
  title: string
  entries: AnimeEntry[]
  primary: AnimeEntry
  active: AnimeEntry
  status: WatchStatus
  progress: number
  episodesTotal: number | null
  averageRating: number | null
  rewatchStatus: RewatchStatus
  updatedAt: string
}

type ImportPreview = {
  fileName: string
  library: AnimeEntry[]
  history: HistoryEvent[]
  invalidCount: number
  warnings: string[]
}

type ProgressUndoSnapshot = {
  entryId: string
  animeTitle: string
  from: number
  to: number
  previous: Pick<AnimeEntry, 'progress' | 'status' | 'lastWatchedAt' | 'startedAt' | 'completedAt'>
}

type CollectionBadge = {
  id: CollectionBadgeId
  label: string
  description: string
  count: number
  icon: typeof LibraryBig
}

type RecommendedAnime = SearchResult & {
  recommendationScore: number
  recommendedFrom: string[]
}

type WatchNotification = {
  id: string
  kind: 'stale' | 'upcoming'
  entry: AnimeEntry
  eyebrow: string
  title: string
  description: string
  meta: string
  actionLabel: string
  icon: typeof Bell
}

type SmartShelf = {
  id: string
  label: string
  description: string
  entries: AnimeEntry[]
  recommendations?: RecommendedAnime[]
  loading?: boolean
  error?: string
}

type FanStats = {
  completionRate: number
  episodesThisMonth: number
  longestPause?: { entry: AnimeEntry; days: number }
  rewatchCount: number
  movies: number
  series: number
  topGenres: Array<{ label: string; count: number }>
  topStudios: Array<{ label: string; count: number }>
  averageByGenre: Array<{ label: string; rating: number; count: number }>
  monthHeatmap: Array<{ label: string; count: number }>
}

type EndCardSnapshot = {
  entry: AnimeEntry
  completedAt: string
}

type AniListMedia = {
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

type AniListRecommendationNode = {
  rating?: number | null
  mediaRecommendation?: AniListMedia | null
}

type JikanEpisode = {
  mal_id?: number
  url?: string
  title?: string
  title_japanese?: string
  title_romanji?: string
  aired?: string | null
  score?: number | null
  filler?: boolean
  recap?: boolean
}

type JikanEpisodeResponse = {
  data?: JikanEpisode[]
  pagination?: {
    last_visible_page?: number
    has_next_page?: boolean
  } | null
}

const statusMeta: Record<
  WatchStatus,
  { label: string; icon: typeof Play; short: string }
> = {
  watching: { label: 'Watching', icon: Play, short: 'Now' },
  planning: { label: 'Plan to Watch', icon: CalendarDays, short: 'Plan' },
  completed: { label: 'Completed', icon: Check, short: 'Done' },
  paused: { label: 'Paused', icon: CirclePause, short: 'Hold' },
  dropped: { label: 'Dropped', icon: Archive, short: 'Drop' },
}

const statusOrder: WatchStatus[] = ['watching', 'planning', 'completed', 'paused', 'dropped']

const rewatchMeta: Record<Exclude<RewatchStatus, 'none'>, { label: string; short: string }> = {
  planned: { label: 'Plan to Rewatch', short: 'Rewatch' },
  rewatching: { label: 'Rewatching', short: 'Again' },
}

const priorityMeta: Record<EntryPriority, { label: string; short: string }> = {
  low: { label: 'Low Priority', short: 'Low' },
  normal: { label: 'Normal Priority', short: 'Normal' },
  high: { label: 'High Priority', short: 'High' },
}

const artPanels = ['/art/duality.png', '/art/rooftop.png', '/art/citadel.png', '/art/rain-guard.png']
const TOAD_SAGE_IMAGE = '/art/toad-sage.jpg'
const SAGE_MODE_KEY = 'gptnime-sage-mode-v1'
const STALE_WATCH_DAYS = 21
const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  staleDays: STALE_WATCH_DAYS,
  onlyWatching: false,
  onlyHighPriority: false,
  mutedAnimeIds: [],
  dismissedNotificationIds: [],
  snoozedUntilById: {},
}
const noteTemplates = [
  { label: 'Favorite character', value: 'Favorite character: ' },
  { label: 'Why dropped', value: 'Why dropped: ' },
  { label: 'Where streaming', value: 'Where streaming: ' },
  { label: 'Watch with friends', value: 'Watch with friends: ' },
]
const sageMicrocopy = [
  'Next summon',
  'Quiet pick',
  'Good signal',
  'One gentle nudge',
]
const franchiseRelationTypes = new Set([
  'PREQUEL',
  'SEQUEL',
  'PARENT',
  'SIDE_STORY',
  'ALTERNATIVE',
  'SPIN_OFF',
  'SUMMARY',
  'COMPILATION',
  'CONTAINS',
  'OTHER',
])
const wordSeasonNumbers: Record<string, number> = {
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  final: 99,
}

function stripSeasonQualifier(title: string) {
  let cleaned = title.replace(/\s+/g, ' ').trim()
  const patterns = [
    /\s*(?:[:-]|\u2013|\u2014)\s*(?:the\s+)?final\s+season\s*$/i,
    /\s+(?:the\s+)?final\s+season\s*$/i,
    /\s*(?:[:-]|\u2013|\u2014)\s*(?:season|part|cour)\s*\d+\s*$/i,
    /\s+(?:season|part|cour)\s*\d+\s*$/i,
    /\s+\d+(?:st|nd|rd|th)\s+season\s*$/i,
    /\s+(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\s*$/i,
    /\s+\((?:season|part|cour)\s*\d+\)\s*$/i,
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of patterns) {
      const next = cleaned.replace(pattern, '').trim()
      if (next !== cleaned && next.length > 1) {
        cleaned = next
        changed = true
      }
    }
  }

  return cleaned || title.trim()
}

function stripFranchiseQualifier(title: string) {
  let cleaned = stripSeasonQualifier(title)
  const patterns = [
    /\s+(?:the\s+)?(?:movie|film)\s*(?:[:-]|\u2013|\u2014)?.*$/i,
    /\s+(?:ova|ona|special|recap|extra edition)\s*(?:[:-]|\u2013|\u2014)?.*$/i,
    /\s+alternative\s*(?:[:-]|\u2013|\u2014)?.*$/i,
  ]

  for (const pattern of patterns) {
    const next = cleaned.replace(pattern, '').trim()
    if (next && next !== cleaned) {
      cleaned = next
    }
  }

  return cleaned || stripSeasonQualifier(title)
}

function normalizeSeriesKey(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactSeriesKey(key: string) {
  return key.replace(/\s+/g, '')
}

function shouldUseSeriesKey(key: string) {
  return compactSeriesKey(key).length >= 6
}

function titleBasesForGrouping(title: string) {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim()
  const bases = new Set([stripSeasonQualifier(normalizedTitle), stripFranchiseQualifier(normalizedTitle)])
  const separatorMatch = normalizedTitle.match(/^(.+?)(?::|\s-\s|\s\u2013\s|\s\u2014\s)/)

  if (separatorMatch?.[1]) {
    bases.add(stripFranchiseQualifier(separatorMatch[1]))
  }

  return [...bases].filter(Boolean)
}

function seriesKeysFor(entry: Pick<SearchResult, 'title' | 'titleEnglish' | 'synonyms'>) {
  const titleCandidates = [
    entry.title,
    entry.titleEnglish,
    ...(entry.synonyms || []),
  ].filter(Boolean) as string[]
  const keys = new Set<string>()

  titleCandidates.forEach((title) => {
    titleBasesForGrouping(title).forEach((base) => {
      const normalized = normalizeSeriesKey(base)
      if (!shouldUseSeriesKey(normalized)) return

      keys.add(normalized)

      const compact = compactSeriesKey(normalized)
      if (compact !== normalized && compact.length >= 6) {
        keys.add(compact)
      }
    })
  })

  return [...keys]
}

function seriesTitleFor(entries: AnimeEntry[]) {
  const stripTitle = entries.length > 1 ? stripFranchiseQualifier : stripSeasonQualifier
  const titles = entries
    .map((entry) => stripTitle(entry.titleEnglish || entry.title))
    .filter(Boolean)
    .sort((first, second) => first.length - second.length)

  return titles[0] || entries[0]?.title || 'Untitled anime'
}

function extractSeasonNumber(title: string) {
  const numericSeason = title.match(/\bseason\s*(\d+)\b/i)
  if (numericSeason) return Number(numericSeason[1])

  const ordinalSeason = title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i)
  if (ordinalSeason) return Number(ordinalSeason[1])

  const wordSeason = title.match(/\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final)\s+season\b/i)
  if (wordSeason) return wordSeasonNumbers[wordSeason[1].toLowerCase()]

  return null
}

function seasonSortValue(entry: AnimeEntry) {
  const explicitSeason = extractSeasonNumber(entry.title)
  if (explicitSeason) return explicitSeason * 10000 + (entry.seasonYear || 0)

  return entry.seasonYear || 0
}

function sortGroupEntries(entries: AnimeEntry[]) {
  return [...entries].sort((first, second) => {
    const firstSeason = seasonSortValue(first)
    const secondSeason = seasonSortValue(second)
    if (firstSeason !== secondSeason) return firstSeason - secondSeason

    return new Date(first.addedAt).getTime() - new Date(second.addedAt).getTime()
  })
}

function activeEntryForGroup(entries: AnimeEntry[]) {
  return (
    entries.find((entry) => entry.status === 'watching') ||
    entries.find((entry) => entry.status === 'planning') ||
    entries.find((entry) => entry.episodesTotal && entry.progress < entry.episodesTotal && entry.status !== 'dropped') ||
    entries[entries.length - 1]
  )
}

function groupStatusFor(entries: AnimeEntry[]): WatchStatus {
  if (entries.some((entry) => entry.status === 'watching')) return 'watching'
  if (entries.some((entry) => entry.status === 'planning')) return 'planning'
  if (entries.every((entry) => entry.status === 'completed')) return 'completed'
  if (entries.some((entry) => entry.status === 'paused')) return 'paused'
  if (entries.every((entry) => entry.status === 'dropped')) return 'dropped'

  return entries[0]?.status || 'planning'
}

function groupRewatchStatusFor(entries: AnimeEntry[]): RewatchStatus {
  if (entries.some((entry) => entry.rewatchStatus === 'rewatching')) return 'rewatching'
  if (entries.some((entry) => entry.rewatchStatus === 'planned')) return 'planned'

  return 'none'
}

function createLibraryGroup(entries: AnimeEntry[]): LibraryGroup {
  const sortedEntries = sortGroupEntries(entries)
  const active = activeEntryForGroup(sortedEntries)
  const ratings = sortedEntries
    .map((entry) => entry.rating)
    .filter((rating): rating is number => rating !== null && rating !== undefined)
  const episodesTotal = sortedEntries.reduce((total, entry) => total + (entry.episodesTotal || 0), 0)
  const title = seriesTitleFor(sortedEntries)
  const latestUpdatedAt = sortedEntries.reduce((latest, entry) => {
    const updatedAt = new Date(entry.updatedAt).getTime()
    return Number.isFinite(updatedAt) && updatedAt > latest ? updatedAt : latest
  }, 0)

  return {
    id: `series-${normalizeSeriesKey(title)}`,
    title,
    entries: sortedEntries,
    primary: active,
    active,
    status: groupStatusFor(sortedEntries),
    progress: sortedEntries.reduce((total, entry) => total + entry.progress, 0),
    episodesTotal: episodesTotal || null,
    averageRating: ratings.length
      ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length
      : null,
    rewatchStatus: groupRewatchStatusFor(sortedEntries),
    updatedAt: new Date(latestUpdatedAt || Date.now()).toISOString(),
  }
}

function buildLibraryGroups(entries: AnimeEntry[]) {
  const parent = new Map<string, string>()
  const byAniListId = new Map<number, AnimeEntry>()

  const find = (id: string): string => {
    const current = parent.get(id) || id
    if (current === id) return id

    const root = find(current)
    parent.set(id, root)
    return root
  }

  const union = (first: string, second: string) => {
    const firstRoot = find(first)
    const secondRoot = find(second)
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot)
  }

  for (const entry of entries) {
    parent.set(entry.id, entry.id)
    byAniListId.set(entry.anilistId, entry)
  }

  for (const entry of entries) {
    entry.relations?.forEach((relation) => {
      const relationType = relation.relationType?.toUpperCase()
      const relatedEntry = byAniListId.get(relation.anilistId)
      if (relatedEntry && relationType && franchiseRelationTypes.has(relationType)) {
        union(entry.id, relatedEntry.id)
      }
    })
  }

  const byTitleKey = new Map<string, AnimeEntry>()
  for (const entry of entries) {
    seriesKeysFor(entry).forEach((key) => {
      const existing = byTitleKey.get(key)
      if (existing) {
        union(existing.id, entry.id)
      } else {
        byTitleKey.set(key, entry)
      }
    })
  }

  const grouped = new Map<string, AnimeEntry[]>()
  for (const entry of entries) {
    const root = find(entry.id)
    grouped.set(root, [...(grouped.get(root) || []), entry])
  }

  return [...grouped.values()].map(createLibraryGroup)
}

const searchQuery = `
query SearchAnime($search: String) {
  Page(page: 1, perPage: 12) {
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      siteUrl
      title {
        romaji
        english
        native
      }
      synonyms
      format
      status
      episodes
      duration
      description(asHtml: false)
      season
      seasonYear
      coverImage {
        extraLarge
        large
        color
      }
      bannerImage
      genres
      averageScore
      meanScore
      popularity
      favourites
      source
      countryOfOrigin
      nextAiringEpisode {
        episode
        airingAt
        timeUntilAiring
      }
      studios(isMain: true) {
        nodes {
          name
        }
      }
    }
  }
}
`

const idQuery = `
query AnimeById($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    siteUrl
    title {
      romaji
      english
      native
    }
    synonyms
    format
    status
    episodes
    duration
    description(asHtml: false)
    season
    seasonYear
    coverImage {
      extraLarge
      large
      color
    }
    bannerImage
    genres
    tags {
      name
      rank
      isMediaSpoiler
    }
    averageScore
    meanScore
    popularity
    favourites
    source
    countryOfOrigin
    hashtag
    trailer {
      id
      site
      thumbnail
    }
    nextAiringEpisode {
      episode
      airingAt
      timeUntilAiring
    }
    studios(isMain: true) {
      nodes {
        id
        name
        siteUrl
      }
    }
    staff(sort: [RELEVANCE, ID], perPage: 12) {
      edges {
        role
        node {
          id
          name {
            full
            native
          }
          image {
            large
          }
          siteUrl
          primaryOccupations
        }
      }
    }
    characters(sort: [ROLE, RELEVANCE, ID], perPage: 8) {
      edges {
        role
        node {
          id
          name {
            full
            native
          }
          image {
            large
          }
          siteUrl
        }
        voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
          id
          name {
            full
            native
          }
          image {
            large
          }
          siteUrl
        }
      }
    }
    relations {
      edges {
        relationType
        node {
          id
          idMal
          type
          title {
            romaji
            english
            native
          }
          format
          status
          episodes
          seasonYear
          coverImage {
            large
          }
        }
      }
    }
    externalLinks {
      site
      url
      icon
      color
      type
    }
    rankings {
      rank
      type
      season
      year
      allTime
      context
    }
  }
}
`

const recommendationQuery = `
query RecommendedAnime($id: Int) {
  Media(id: $id, type: ANIME) {
    recommendations(sort: RATING_DESC, perPage: 10) {
      nodes {
        rating
        mediaRecommendation {
          id
          idMal
          isAdult
          siteUrl
          title {
            romaji
            english
            native
          }
          synonyms
          format
          status
          episodes
          duration
          description(asHtml: false)
          season
          seasonYear
          coverImage {
            extraLarge
            large
            color
          }
          bannerImage
          genres
          averageScore
          meanScore
          popularity
          favourites
          source
          countryOfOrigin
          nextAiringEpisode {
            episode
            airingAt
            timeUntilAiring
          }
          studios(isMain: true) {
            nodes {
              name
            }
          }
        }
      }
    }
  }
}
`

function createId() {
  if ('randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cleanText(value?: string | null) {
  if (!value) return ''

  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mapMedia(media: AniListMedia): SearchResult {
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
    synonyms: media.synonyms || [],
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

async function postAniList<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal) {
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

async function searchAniList(term: string, signal?: AbortSignal) {
  const data = await postAniList<{ Page: { media: AniListMedia[] } }>(searchQuery, {
    search: term,
  }, signal)

  return data.Page.media.map(mapMedia)
}

async function fetchAniListById(id: number, signal?: AbortSignal) {
  const data = await postAniList<{ Media: AniListMedia }>(idQuery, { id }, signal)
  return mapMedia(data.Media)
}

function recommendationSignalFor(entry: AnimeEntry) {
  if (entry.status === 'dropped') return -40

  let score = 0

  if (typeof entry.rating === 'number') {
    score += entry.rating * 18
    if (entry.rating < 6) score -= 45
  }
  if (entry.favorite) score += 42
  if (entry.rewatchWorthy) score += 28
  if (entry.priority === 'high') score += 14
  if (entry.status === 'completed') score += 24
  if (entry.status === 'watching') score += 18
  if (entry.status === 'paused') score += 6
  if (isRewatchQueued(entry)) score += 18
  if (entry.rewatchCount) score += Math.min(24, entry.rewatchCount * 8)
  if (entry.progress) score += Math.min(18, Math.ceil(entry.progress / 2))

  return score
}

function recommendationSeedsFor(entries: AnimeEntry[]) {
  return entries
    .map((entry) => ({ entry, score: recommendationSignalFor(entry) }))
    .filter(({ score }) => score > 0)
    .sort((first, second) => {
      if (second.score !== first.score) return second.score - first.score

      return new Date(second.entry.updatedAt).getTime() - new Date(first.entry.updatedAt).getTime()
    })
    .slice(0, 5)
}

function recommendationTitleKeysFor(entry: Pick<SearchResult, 'title' | 'titleEnglish' | 'synonyms'>) {
  return seriesKeysFor(entry).filter((key) => compactSeriesKey(key).length >= 8)
}

function recommendationContextFor(entry: AnimeEntry) {
  if (entry.rating === 10 && entry.favorite) return `${entry.title} (10/10 favorite)`
  if (typeof entry.rating === 'number' && entry.rating >= 8) return `${entry.title} (${entry.rating.toFixed(1)}/10)`
  if (entry.favorite) return `${entry.title} (favorite)`
  if (entry.rewatchWorthy || isRewatchQueued(entry)) return `${entry.title} (rewatch pick)`
  return entry.title
}

async function fetchRecommendedAnimeForLibrary(entries: AnimeEntry[], signal?: AbortSignal) {
  const seeds = recommendationSeedsFor(entries)
  if (!seeds.length) return []

  const trackedIds = new Set(entries.map((entry) => entry.anilistId))
  const trackedTitleKeys = new Set(entries.flatMap(recommendationTitleKeysFor))
  const likedGenres = new Set(
    entries
      .filter((entry) => entry.favorite || entry.rewatchWorthy || (typeof entry.rating === 'number' && entry.rating >= 8))
      .flatMap((entry) => entry.genres),
  )
  const candidates = new Map<number, { result: SearchResult; score: number; from: Set<string> }>()

  await Promise.all(
    seeds.map(async ({ entry: seed, score: seedScore }) => {
      const data = await postAniList<{
        Media?: {
          recommendations?: {
            nodes?: AniListRecommendationNode[] | null
          } | null
        } | null
      }>(recommendationQuery, { id: seed.anilistId }, signal)

      data.Media?.recommendations?.nodes?.forEach((node) => {
        const media = node.mediaRecommendation
        if (!media || media.isAdult || trackedIds.has(media.id)) return

        const result = mapMedia(media)
        const titleKeys = recommendationTitleKeysFor(result)
        if (titleKeys.some((key) => trackedTitleKeys.has(key))) return

        const genreBoost = result.genres.filter((genre) => likedGenres.has(genre)).length * 5
        const qualityScore = ((result.averageScore || result.meanScore || 0) / 10) + Math.log10((result.popularity || 0) + 10)
        const recommendationScore = (node.rating || 0) + seedScore / 18 + genreBoost + qualityScore
        const existing = candidates.get(result.anilistId)
        const fromLabel = recommendationContextFor(seed)

        if (existing) {
          existing.score += recommendationScore * 0.72
          existing.from.add(fromLabel)
          return
        }

        candidates.set(result.anilistId, {
          result,
          score: recommendationScore,
          from: new Set([fromLabel]),
        })
      })
    }),
  )

  return [...candidates.values()]
    .map(({ result, score, from }) => ({
      ...result,
      recommendationScore: score,
      recommendedFrom: [...from],
    }))
    .sort((first, second) => second.recommendationScore - first.recommendationScore || (second.averageScore || 0) - (first.averageScore || 0))
    .slice(0, 8)
}

function waitForJikan(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'))
      return
    }

    const timer = window.setTimeout(resolve, JIKAN_PAGE_DELAY_MS)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Request aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function mapJikanEpisode(episode: JikanEpisode): EpisodeInfo {
  return {
    number: episode.mal_id || 0,
    title: episode.title || `Episode ${episode.mal_id || '?'}`,
    titleJapanese: episode.title_japanese || undefined,
    titleRomanji: episode.title_romanji || undefined,
    aired: episode.aired,
    score: episode.score,
    filler: episode.filler,
    recap: episode.recap,
    url: episode.url,
  }
}

async function fetchJikanEpisodes(idMal: number, signal?: AbortSignal) {
  const episodes: EpisodeInfo[] = []
  let page = 1
  let lastPage = 1

  do {
    const response = await fetch(`${JIKAN_ENDPOINT}/anime/${idMal}/episodes?page=${page}`, { signal })

    if (!response.ok) {
      throw new Error(`Jikan episode request failed: ${response.status}`)
    }

    const payload = (await response.json()) as JikanEpisodeResponse
    episodes.push(...(payload.data || []).map(mapJikanEpisode).filter((episode) => episode.number > 0))
    lastPage = payload.pagination?.last_visible_page || page
    page += 1

    if (page <= lastPage) {
      await waitForJikan(signal)
    }
  } while (page <= lastPage)

  return episodes.sort((first, second) => first.number - second.number)
}

async function fetchHydratedDetails(entry: AnimeEntry, signal?: AbortSignal) {
  const fresh = await fetchAniListById(entry.anilistId, signal)
  let episodeList = entry.episodeList || []
  let episodeListLoaded = entry.episodeListLoaded || false
  let episodeListError = ''

  if (fresh.idMal) {
    try {
      episodeList = await fetchJikanEpisodes(fresh.idMal, signal)
      episodeListLoaded = true
    } catch (error) {
      if (signal?.aborted) throw error
      episodeListError = error instanceof Error ? error.message : 'Episode list unavailable'
    }
  }

  return {
    ...fresh,
    episodeList,
    episodeListLoaded,
    episodeListError,
    detailsLoaded: true,
    detailsUpdatedAt: new Date().toISOString(),
  } satisfies Partial<AnimeEntry>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizedStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizedDateString(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? value : fallback
}

function normalizedWatchStatus(value: unknown): WatchStatus {
  return statusOrder.includes(value as WatchStatus) ? value as WatchStatus : 'planning'
}

function normalizedRewatchStatus(value: unknown): RewatchStatus {
  return value === 'planned' || value === 'rewatching' ? value : 'none'
}

function normalizedPriority(value: unknown): EntryPriority {
  return value === 'low' || value === 'high' ? value : 'normal'
}

function normalizedRating(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(10, Math.max(0, value))
}

function normalizeAnimeEntry(value: unknown): AnimeEntry | null {
  if (!isRecord(value)) return null

  const anilistId = typeof value.anilistId === 'number' ? value.anilistId : Number(value.anilistId)
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : ''
  if (!Number.isFinite(anilistId) || !title) return null

  const now = new Date().toISOString()
  const raw = value as Partial<AnimeEntry>
  const episodesTotal = typeof raw.episodesTotal === 'number' && Number.isFinite(raw.episodesTotal)
    ? Math.max(0, raw.episodesTotal)
    : raw.episodesTotal ?? null
  const progress = typeof raw.progress === 'number' && Number.isFinite(raw.progress) ? Math.max(0, Math.floor(raw.progress)) : 0

  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    anilistId,
    idMal: typeof raw.idMal === 'number' ? raw.idMal : raw.idMal ?? null,
    title,
    titleEnglish: typeof raw.titleEnglish === 'string' ? raw.titleEnglish : undefined,
    nativeTitle: typeof raw.nativeTitle === 'string' ? raw.nativeTitle : undefined,
    synonyms: normalizedStringArray(raw.synonyms),
    format: raw.format ?? null,
    releaseStatus: raw.releaseStatus ?? null,
    episodesTotal,
    duration: typeof raw.duration === 'number' ? raw.duration : raw.duration ?? null,
    description: typeof raw.description === 'string' ? raw.description : '',
    season: raw.season ?? null,
    seasonYear: typeof raw.seasonYear === 'number' ? raw.seasonYear : raw.seasonYear ?? null,
    coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : undefined,
    bannerImage: typeof raw.bannerImage === 'string' ? raw.bannerImage : raw.bannerImage ?? null,
    color: typeof raw.color === 'string' ? raw.color : raw.color ?? null,
    genres: normalizedStringArray(raw.genres),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    averageScore: typeof raw.averageScore === 'number' ? raw.averageScore : raw.averageScore ?? null,
    meanScore: typeof raw.meanScore === 'number' ? raw.meanScore : raw.meanScore ?? null,
    popularity: typeof raw.popularity === 'number' ? raw.popularity : raw.popularity ?? null,
    favourites: typeof raw.favourites === 'number' ? raw.favourites : raw.favourites ?? null,
    source: raw.source ?? null,
    countryOfOrigin: raw.countryOfOrigin ?? null,
    hashtag: raw.hashtag ?? null,
    siteUrl: raw.siteUrl ?? null,
    trailer: raw.trailer ?? null,
    studios: normalizedStringArray(raw.studios),
    staff: Array.isArray(raw.staff) ? raw.staff : undefined,
    characters: Array.isArray(raw.characters) ? raw.characters : undefined,
    relations: Array.isArray(raw.relations) ? raw.relations : undefined,
    externalLinks: Array.isArray(raw.externalLinks) ? raw.externalLinks : undefined,
    rankings: Array.isArray(raw.rankings) ? raw.rankings : undefined,
    nextAiringEpisode: raw.nextAiringEpisode ?? null,
    status: normalizedWatchStatus(raw.status),
    progress: episodesTotal ? Math.min(episodesTotal, progress) : progress,
    rating: normalizedRating(raw.rating),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    episodeMemo: typeof raw.episodeMemo === 'string' ? raw.episodeMemo : '',
    addedAt: normalizedDateString(raw.addedAt, now),
    updatedAt: normalizedDateString(raw.updatedAt, now),
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : undefined,
    lastWatchedAt: typeof raw.lastWatchedAt === 'string' ? raw.lastWatchedAt : undefined,
    rewatchStatus: normalizedRewatchStatus(raw.rewatchStatus),
    rewatchPlannedAt: typeof raw.rewatchPlannedAt === 'string' ? raw.rewatchPlannedAt : undefined,
    rewatchStartedAt: typeof raw.rewatchStartedAt === 'string' ? raw.rewatchStartedAt : undefined,
    rewatchCount: typeof raw.rewatchCount === 'number' ? raw.rewatchCount : 0,
    episodeList: Array.isArray(raw.episodeList) ? raw.episodeList : undefined,
    episodeListLoaded: Boolean(raw.episodeListLoaded),
    episodeListError: typeof raw.episodeListError === 'string' ? raw.episodeListError : undefined,
    detailsLoaded: Boolean(raw.detailsLoaded),
    detailsUpdatedAt: typeof raw.detailsUpdatedAt === 'string' ? raw.detailsUpdatedAt : undefined,
    favorite: Boolean(raw.favorite),
    rewatchWorthy: Boolean(raw.rewatchWorthy),
    priority: normalizedPriority(raw.priority),
    droppedReason: typeof raw.droppedReason === 'string' ? raw.droppedReason : '',
  }
}

function normalizeHistoryEvent(value: unknown): HistoryEvent | null {
  if (!isRecord(value)) return null
  if (typeof value.animeTitle !== 'string' || typeof value.message !== 'string') return null

  const validTypes: HistoryEventType[] = ['added', 'progress', 'rating', 'status', 'note', 'removed', 'import', 'refresh', 'rewatch', 'label']
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createId(),
    animeId: typeof value.animeId === 'string' ? value.animeId : undefined,
    animeTitle: value.animeTitle,
    type: validTypes.includes(value.type as HistoryEventType) ? value.type as HistoryEventType : 'note',
    message: value.message,
    at: normalizedDateString(value.at, new Date().toISOString()),
  }
}

function normalizeStoredState(parsed: unknown): StoredState & { invalidCount: number } {
  const record = isRecord(parsed) ? parsed : {}
  const rawLibrary = Array.isArray(record.library) ? record.library : []
  const rawHistory = Array.isArray(record.history) ? record.history : []
  const library = rawLibrary.map(normalizeAnimeEntry).filter((entry): entry is AnimeEntry => Boolean(entry))
  const history = rawHistory.map(normalizeHistoryEvent).filter((event): event is HistoryEvent => Boolean(event))

  return {
    library,
    history,
    invalidCount: rawLibrary.length - library.length,
  }
}

function readStoredState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return { library: [], history: [] }
    }

    return normalizeStoredState(JSON.parse(stored))
  } catch {
    return { library: [], history: [] }
  }
}

function readNotificationPreferences(): NotificationPreferences {
  try {
    const stored = localStorage.getItem(NOTIFICATION_PREFS_KEY)
    if (!stored) return DEFAULT_NOTIFICATION_PREFS

    const parsed = JSON.parse(stored)
    if (!isRecord(parsed)) return DEFAULT_NOTIFICATION_PREFS

    const staleDays =
      typeof parsed.staleDays === 'number' && Number.isFinite(parsed.staleDays)
        ? Math.min(120, Math.max(3, Math.floor(parsed.staleDays)))
        : DEFAULT_NOTIFICATION_PREFS.staleDays

    return {
      staleDays,
      onlyWatching: Boolean(parsed.onlyWatching),
      onlyHighPriority: Boolean(parsed.onlyHighPriority),
      mutedAnimeIds: normalizedStringArray(parsed.mutedAnimeIds),
      dismissedNotificationIds: normalizedStringArray(parsed.dismissedNotificationIds),
      snoozedUntilById: isRecord(parsed.snoozedUntilById)
        ? Object.fromEntries(
            Object.entries(parsed.snoozedUntilById).filter(
              (item): item is [string, string] => typeof item[0] === 'string' && typeof item[1] === 'string',
            ),
          )
        : {},
    }
  } catch {
    return DEFAULT_NOTIFICATION_PREFS
  }
}

function notificationIsSnoozed(id: string, preferences: NotificationPreferences) {
  const snoozedUntil = preferences.snoozedUntilById[id]
  if (!snoozedUntil) return false

  const time = new Date(snoozedUntil).getTime()
  return Number.isFinite(time) && time > Date.now()
}

function notificationAllowed(entry: AnimeEntry, notificationId: string, preferences: NotificationPreferences) {
  if (preferences.mutedAnimeIds.includes(entry.id)) return false
  if (preferences.dismissedNotificationIds.includes(notificationId)) return false
  if (notificationIsSnoozed(notificationId, preferences)) return false
  if (preferences.onlyWatching && entry.status !== 'watching') return false
  if (preferences.onlyHighPriority && entry.priority !== 'high') return false

  return true
}

function parseImportPreview(text: string, fileName: string): ImportPreview {
  const normalized = normalizeStoredState(JSON.parse(text))
  const warnings: string[] = []

  if (!normalized.library.length) {
    warnings.push('No valid anime entries were found in this file.')
  }
  if (normalized.invalidCount) {
    warnings.push(`${normalized.invalidCount} invalid title${normalized.invalidCount === 1 ? '' : 's'} skipped during validation.`)
  }
  if (!normalized.history.length) {
    warnings.push('No valid watch history was found in this file.')
  }

  return {
    fileName,
    library: normalized.library,
    history: normalized.history,
    invalidCount: normalized.invalidCount,
    warnings,
  }
}

function downloadStateSnapshot(library: AnimeEntry[], history: HistoryEvent[], prefix: string) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    library,
    history,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function mergeLibraryEntries(current: AnimeEntry[], incoming: AnimeEntry[]) {
  const byAniListId = new Map<number, AnimeEntry>()
  current.forEach((entry) => byAniListId.set(entry.anilistId, entry))

  incoming.forEach((entry) => {
    const existing = byAniListId.get(entry.anilistId)
    byAniListId.set(
      entry.anilistId,
      existing
        ? {
            ...existing,
            ...entry,
            id: existing.id,
            addedAt: existing.addedAt || entry.addedAt,
            updatedAt: new Date().toISOString(),
          }
        : entry,
    )
  })

  return [...byAniListId.values()]
}

function mergeHistoryEvents(current: HistoryEvent[], incoming: HistoryEvent[]) {
  const seen = new Set<string>()
  return [...incoming, ...current]
    .filter((event) => {
      if (seen.has(event.id)) return false
      seen.add(event.id)
      return true
    })
    .sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime())
    .slice(0, 500)
}

function formatDate(value?: string | number | null) {
  if (!value) return 'Not set'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatShortDate(value?: string | null) {
  if (!value) return 'Not set'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function formatEpisodeDate(value?: string | null) {
  if (!value) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function formatNumber(value?: number | null) {
  if (!value && value !== 0) return '-'
  return new Intl.NumberFormat().format(value)
}

function formatSeason(entry: SearchResult) {
  return [entry.season, entry.seasonYear].filter(Boolean).join(' ') || '-'
}

const streamingSitePattern = /(crunchyroll|netflix|hulu|hidive|disney|prime video|amazon|youtube|bilibili|tubi|hbo|max|pluto|adult swim|vrv)/i

function officialWatchLinksFor(entry: AnimeEntry) {
  const seen = new Set<string>()

  return (entry.externalLinks || [])
    .filter((link) => {
      if (!link.url || seen.has(link.url)) return false
      const type = link.type?.toLowerCase() || ''
      const watchLike = type.includes('streaming') || streamingSitePattern.test(link.site)
      if (watchLike) seen.add(link.url)
      return watchLike
    })
    .slice(0, 4)
}

function episodeRowsFor(entry: AnimeEntry): EpisodeInfo[] {
  if (entry.episodeList?.length) return entry.episodeList
  if (!entry.episodesTotal) return []

  return Array.from({ length: entry.episodesTotal }, (_, index) => {
    const number = index + 1
    return {
      number,
      title: `Episode ${number}`,
    }
  })
}

function progressPercentValue(progress: number, episodesTotal?: number | null) {
  if (!episodesTotal) return progress > 0 ? 62 : 0
  return Math.min(100, Math.round((progress / episodesTotal) * 100))
}

function groupProgressPercent(group: LibraryGroup) {
  return progressPercentValue(group.progress, group.episodesTotal)
}

function daysSince(value?: string | null) {
  if (!value) return 0
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 0

  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function activityDateFor(entry: AnimeEntry) {
  return entry.lastWatchedAt || entry.updatedAt || entry.addedAt
}

function isUnfinishedEntry(entry: AnimeEntry) {
  if (entry.status === 'completed' || entry.status === 'dropped') return false
  return !entry.episodesTotal || entry.progress < entry.episodesTotal
}

function isMovieEntry(entry: AnimeEntry) {
  const title = `${entry.title} ${entry.titleEnglish || ''}`.toLowerCase()
  return entry.format === 'MOVIE' || /\b(movie|film)\b/.test(title)
}

function isCompletedEntry(entry: AnimeEntry) {
  return entry.status === 'completed' || Boolean(entry.episodesTotal && entry.progress >= entry.episodesTotal)
}

function isStaleWatchEntry(entry: AnimeEntry, staleDays = STALE_WATCH_DAYS) {
  const watchedEnoughToForget = entry.progress > 0 || entry.status === 'watching' || entry.status === 'paused'
  return isUnfinishedEntry(entry) && watchedEnoughToForget && daysSince(activityDateFor(entry)) >= staleDays
}

function staleWatchEntriesFor(entries: AnimeEntry[], staleDays = STALE_WATCH_DAYS) {
  return entries
    .filter((entry) => isStaleWatchEntry(entry, staleDays))
    .sort((first, second) => {
      const dayDiff = daysSince(activityDateFor(second)) - daysSince(activityDateFor(first))
      if (dayDiff) return dayDiff

      return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
    })
}

function collectionBadgesFor(entries: AnimeEntry[], groups: LibraryGroup[]): CollectionBadge[] {
  const franchiseMasterCount = groups.filter(
    (group) => group.entries.length >= 3 && group.entries.every(isCompletedEntry),
  ).length
  const movieNightCount = entries.filter((entry) => isMovieEntry(entry) && isCompletedEntry(entry)).length
  const rewatchPickCount = entries.filter((entry) => entry.rewatchWorthy || isRewatchQueued(entry)).length
  const highPriorityCount = entries.filter((entry) => entry.priority === 'high').length
  const leftHangingCount = staleWatchEntriesFor(entries).length

  return [
    {
      id: 'franchise-master',
      label: 'Franchise Master',
      description: 'Complete a multi-entry franchise.',
      count: franchiseMasterCount,
      icon: LibraryBig,
    },
    {
      id: 'movie-night',
      label: 'Movie Night',
      description: 'Finish anime films or movie arcs.',
      count: movieNightCount,
      icon: Play,
    },
    {
      id: 'rewatch-pick',
      label: 'Rewatch Pick',
      description: 'Flag titles worth another run.',
      count: rewatchPickCount,
      icon: RefreshCcw,
    },
    {
      id: 'high-priority',
      label: 'High Priority',
      description: 'Keep important titles surfaced.',
      count: highPriorityCount,
      icon: Flame,
    },
    {
      id: 'left-hanging',
      label: 'Left Hanging',
      description: 'Unfinished shows quiet for 21+ days.',
      count: leftHangingCount,
      icon: Clock3,
    },
  ]
}

function statusClass(status: WatchStatus) {
  return `status-pill status-pill-${status}`
}

function rewatchClass(status?: RewatchStatus) {
  return `rewatch-pill rewatch-pill-${status || 'none'}`
}

function isRewatchQueued(entry: AnimeEntry) {
  return entry.rewatchStatus === 'planned' || entry.rewatchStatus === 'rewatching'
}

function isGroupRewatchQueued(group: LibraryGroup) {
  return group.rewatchStatus === 'planned' || group.rewatchStatus === 'rewatching'
}

function hasFranchiseQualifier(title: string) {
  return normalizeSeriesKey(stripFranchiseQualifier(title)) !== normalizeSeriesKey(stripSeasonQualifier(title))
}

function seasonLabelFor(entry: AnimeEntry, group: LibraryGroup, index: number) {
  const explicitSeason = extractSeasonNumber(entry.title)
  const basicFormat = entry.format?.replace(/_/g, ' ')
  const baseLabel =
    explicitSeason && explicitSeason < 90
      ? `Season ${explicitSeason}`
      : group.entries.length > 1 &&
          !hasFranchiseQualifier(entry.title) &&
          (!entry.format || entry.format === 'TV' || entry.format === 'TV_SHORT')
        ? `Season ${index + 1}`
        : basicFormat || 'Entry'

  return entry.seasonYear ? `${baseLabel} - ${entry.seasonYear}` : baseLabel
}

function isCompleteRunGroup(group: LibraryGroup) {
  return group.entries.length > 1 && group.entries.every(isCompletedEntry)
}

function hasPerfectFavorite(entry: AnimeEntry) {
  return Boolean(entry.favorite && entry.rating === 10)
}

function ambientSeasonForDate(date: Date): AmbientSeason {
  const month = date.getMonth()
  if (month <= 1 || month === 11) return 'winter'
  if (month <= 4) return 'spring'
  if (month <= 7) return 'summer'
  return 'fall'
}

function isLateNight(date: Date) {
  const hour = date.getHours()
  return hour >= 23 || hour < 5
}

function nextEpisodeLabelFor(entry: AnimeEntry) {
  const nextEpisode = Math.max(1, entry.progress + 1)
  return entry.episodesTotal ? `Ep ${nextEpisode} / ${entry.episodesTotal}` : `Ep ${nextEpisode}`
}

function lastWatchedLabelFor(entry: AnimeEntry) {
  if (!entry.progress) return 'Not started yet'
  return `Last watched Ep ${entry.progress} on ${formatShortDate(entry.lastWatchedAt || entry.updatedAt)}`
}

function progressTrackClass(entry?: AnimeEntry, className = '') {
  return [
    'progress-track',
    entry && isRewatchQueued(entry) ? 'progress-track-rewatch' : '',
    className,
  ].filter(Boolean).join(' ')
}

function progressMilestones(progress: number, episodesTotal?: number | null) {
  if (!episodesTotal || episodesTotal < 2) return []

  const first = Math.min(100, Math.max(0, Math.round((1 / episodesTotal) * 100)))
  return [
    { id: 'first', label: 'Episode 1', left: first, reached: progress >= 1 },
    { id: 'half', label: 'Halfway', left: 50, reached: progress >= Math.ceil(episodesTotal / 2) },
    { id: 'finale', label: 'Finale', left: 100, reached: progress >= episodesTotal },
  ]
}

function countLabels(values: string[], limit = 5) {
  const counts = new Map<string, number>()
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1))

  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }))
}

function episodesWatchedThisMonth(history: HistoryEvent[]) {
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()

  return history.reduce((total, event) => {
    if (event.type !== 'progress') return total

    const date = new Date(event.at)
    if (date.getMonth() !== month || date.getFullYear() !== year) return total

    const match = event.message.match(/(\d+)\s*->\s*(\d+)/)
    if (!match) return total

    return total + Math.max(0, Number(match[2]) - Number(match[1]))
  }, 0)
}

function monthHeatmapFor(history: HistoryEvent[]) {
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const now = new Date()

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1)
    const count = history.filter((event) => {
      const eventDate = new Date(event.at)
      return eventDate.getMonth() === date.getMonth() && eventDate.getFullYear() === date.getFullYear()
    }).length

    return {
      label: formatter.format(date),
      count,
    }
  })
}

function fanStatsFor(entries: AnimeEntry[], history: HistoryEvent[]): FanStats {
  const completed = entries.filter(isCompletedEntry)
  const rated = entries.filter((entry) => typeof entry.rating === 'number')
  const genreRatings = new Map<string, { total: number; count: number }>()

  rated.forEach((entry) => {
    entry.genres.forEach((genre) => {
      const current = genreRatings.get(genre) || { total: 0, count: 0 }
      genreRatings.set(genre, {
        total: current.total + (entry.rating || 0),
        count: current.count + 1,
      })
    })
  })

  const unfinishedQuiet = entries
    .filter((entry) => isUnfinishedEntry(entry) && entry.progress > 0)
    .map((entry) => ({ entry, days: daysSince(activityDateFor(entry)) }))
    .sort((first, second) => second.days - first.days)

  return {
    completionRate: entries.length ? Math.round((completed.length / entries.length) * 100) : 0,
    episodesThisMonth: episodesWatchedThisMonth(history),
    longestPause: unfinishedQuiet[0],
    rewatchCount: entries.reduce((total, entry) => total + (entry.rewatchCount || 0) + (isRewatchQueued(entry) ? 1 : 0), 0),
    movies: entries.filter(isMovieEntry).length,
    series: entries.filter((entry) => !isMovieEntry(entry)).length,
    topGenres: countLabels(entries.flatMap((entry) => entry.genres), 5),
    topStudios: countLabels(entries.flatMap((entry) => entry.studios), 5),
    averageByGenre: [...genreRatings.entries()]
      .map(([label, value]) => ({
        label,
        rating: value.total / value.count,
        count: value.count,
      }))
      .sort((first, second) => second.rating - first.rating || second.count - first.count)
      .slice(0, 5),
    monthHeatmap: monthHeatmapFor(history),
  }
}

function smartShelvesFor(
  entries: AnimeEntry[],
  recommendations: RecommendedAnime[],
  recommendationsLoading: boolean,
  recommendationsError: string,
): SmartShelf[] {
  const unfinished = entries.filter(isUnfinishedEntry)
  const topStudio = countLabels(entries.flatMap((entry) => entry.studios), 1)[0]?.label

  const recommendationShelf: SmartShelf = {
    id: 'recommended-for-you',
    label: 'Recommended for you',
    description: 'Fresh AniList picks seeded by your ratings, favorites, rewatches, and completed titles. Anything already tracked is excluded.',
    entries: [],
    recommendations,
    loading: recommendationsLoading,
    error: recommendationsError,
  }

  const shelves: SmartShelf[] = [
    {
      id: 'caught-up',
      label: 'One episode from caught up',
      description: 'Titles that only need one more episode logged.',
      entries: unfinished.filter((entry) => Boolean(entry.episodesTotal && entry.episodesTotal - entry.progress === 1)),
    },
    {
      id: 'short-finishes',
      label: 'Short finishes',
      description: 'Compact seasons you can finish without a long commitment.',
      entries: unfinished.filter((entry) => Boolean(entry.episodesTotal && entry.episodesTotal <= 13)),
    },
    {
      id: 'high-priority-stalled',
      label: 'High-priority stalled',
      description: 'Important titles that have gone quiet.',
      entries: unfinished.filter((entry) => entry.priority === 'high' && (entry.status === 'paused' || daysSince(activityDateFor(entry)) >= 14)),
    },
    {
      id: 'comfort-rewatches',
      label: 'Comfort rewatches',
      description: 'Favorites and rewatch-worthy titles ready for another run.',
      entries: entries.filter((entry) => isCompletedEntry(entry) && (entry.favorite || entry.rewatchWorthy || isRewatchQueued(entry))),
    },
    {
      id: 'movies-under-two',
      label: 'Movies under 2 hours',
      description: 'Film-length picks for a single sitting.',
      entries: entries.filter((entry) => isMovieEntry(entry) && (!entry.duration || entry.duration <= 120)),
    },
    {
      id: 'studio-spotlight',
      label: topStudio ? `${topStudio} spotlight` : 'Studio spotlight',
      description: 'The studio showing up most in your library.',
      entries: topStudio ? entries.filter((entry) => entry.studios.includes(topStudio)) : [],
    },
    {
      id: 'long-runners',
      label: 'Long runners',
      description: 'Bigger episode counts worth treating as a project.',
      entries: entries.filter((entry) => Boolean(entry.episodesTotal && entry.episodesTotal >= 50)),
    },
  ].filter((shelf) => shelf.entries.length)

  return entries.length ? [recommendationShelf, ...shelves] : shelves
}

function App() {
  const initialState = useMemo(readStoredState, [])
  const initialNotificationPreferences = useMemo(readNotificationPreferences, [])
  const [library, setLibrary] = useState<AnimeEntry[]>(initialState.library)
  const [history, setHistory] = useState<HistoryEvent[]>(initialState.history)
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(initialNotificationPreferences)
  const [view, setView] = useState<ViewName>('dashboard')
  const [selectedId, setSelectedId] = useState<string | null>(initialState.library[0]?.id || null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [lastSearchTerm, setLastSearchTerm] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<LibraryFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)
  const [detailError, setDetailError] = useState('')
  const [focusModalOpen, setFocusModalOpen] = useState(false)
  const [focusLayout, setFocusLayout] = useState<FocusLayout>(() =>
    localStorage.getItem(FOCUS_LAYOUT_KEY) === 'compact' ? 'compact' : 'cinematic',
  )
  const [lastProgressChange, setLastProgressChange] = useState<ProgressUndoSnapshot | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [sageMode, setSageMode] = useState(() => localStorage.getItem(SAGE_MODE_KEY) === 'on')
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false)
  const [animeChannelOpen, setAnimeChannelOpen] = useState(false)
  const [brandPulse, setBrandPulse] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [endCard, setEndCard] = useState<EndCardSnapshot | null>(null)
  const [recommendedAnime, setRecommendedAnime] = useState<RecommendedAnime[]>([])
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [recommendationError, setRecommendationError] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchRunRef = useRef(0)
  const sageClickCountRef = useRef(0)
  const sageClickTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ library, history }))
  }, [library, history])

  useEffect(() => {
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notificationPreferences))
  }, [notificationPreferences])

  useEffect(() => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, focusLayout)
  }, [focusLayout])

  useEffect(() => {
    localStorage.setItem(SAGE_MODE_KEY, sageMode ? 'on' : 'off')
  }, [sageMode])

  useEffect(() => () => window.clearTimeout(sageClickTimerRef.current), [])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const query = searchTerm.trim().toLowerCase()
    if (query !== 'sage' && query !== 'gptnime') return

    setBrandPulse(true)
    const timer = window.setTimeout(() => setBrandPulse(false), 1400)
    return () => window.clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    if (!notificationDrawerOpen && !animeChannelOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setNotificationDrawerOpen(false)
      setAnimeChannelOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [animeChannelOpen, notificationDrawerOpen])

  useEffect(() => {
    if (selectedId && library.some((entry) => entry.id === selectedId)) return
    setSelectedId(library[0]?.id || null)
  }, [library, selectedId])

  useEffect(() => {
    if (!recommendationSeedsFor(library).length) {
      setRecommendedAnime([])
      setRecommendationLoading(false)
      setRecommendationError('')
      return
    }

    const controller = new AbortController()
    let cancelled = false

    setRecommendationLoading(true)
    setRecommendationError('')

    void (async () => {
      try {
        const recommendations = await fetchRecommendedAnimeForLibrary(library, controller.signal)
        if (cancelled) return

        setRecommendedAnime(recommendations)
      } catch (error) {
        if (controller.signal.aborted || cancelled) return

        setRecommendedAnime([])
        setRecommendationError(error instanceof Error ? error.message : 'Could not load recommendations')
      } finally {
        if (!cancelled) {
          setRecommendationLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [library])

  const selectedEntry = useMemo(
    () => library.find((entry) => entry.id === selectedId) || null,
    [library, selectedId],
  )

  useEffect(() => {
    if (!selectedEntry) return
    if (
      selectedEntry.detailsLoaded &&
      (selectedEntry.episodeListLoaded || !selectedEntry.idMal || Boolean(selectedEntry.episodeListError))
    ) {
      return
    }

    const controller = new AbortController()
    let cancelled = false

    setDetailLoadingId(selectedEntry.id)
    setDetailError('')

    void (async () => {
      try {
        const patch = await fetchHydratedDetails(selectedEntry, controller.signal)
        if (cancelled) return

        setLibrary((current) =>
          current.map((entry) =>
            entry.id === selectedEntry.id
              ? {
                  ...entry,
                  ...patch,
                  updatedAt: new Date().toISOString(),
                }
              : entry,
          ),
        )
      } catch (error) {
        if (controller.signal.aborted || cancelled) return
        setDetailError(error instanceof Error ? error.message : 'Could not load detail data')
      } finally {
        if (!cancelled) {
          setDetailLoadingId(null)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedEntry])

  const stats = useMemo(() => {
    const ratedEntries = library.filter((entry) => entry.rating !== null)
    const episodesWatched = library.reduce((total, entry) => total + entry.progress, 0)
    const upcoming = library
      .filter((entry) => entry.nextAiringEpisode?.airingAt)
      .sort((first, second) => {
        const firstDate = first.nextAiringEpisode?.airingAt || 0
        const secondDate = second.nextAiringEpisode?.airingAt || 0
        return firstDate - secondDate
      })

    return {
      total: library.length,
      watching: library.filter((entry) => entry.status === 'watching').length,
      completed: library.filter((entry) => entry.status === 'completed').length,
      planning: library.filter((entry) => entry.status === 'planning').length,
      episodesWatched,
      averageRating: ratedEntries.length
        ? ratedEntries.reduce((total, entry) => total + (entry.rating || 0), 0) / ratedEntries.length
        : 0,
      nextUp: upcoming[0],
    }
  }, [library])

  const libraryGroups = useMemo(() => buildLibraryGroups(library), [library])
  const staleEntries = useMemo(
    () => staleWatchEntriesFor(library, notificationPreferences.staleDays).slice(0, 5),
    [library, notificationPreferences.staleDays],
  )
  const collectionBadges = useMemo(() => collectionBadgesFor(library, libraryGroups), [library, libraryGroups])
  const fanStats = useMemo(() => fanStatsFor(library, history), [history, library])
  const smartShelves = useMemo(
    () => smartShelvesFor(library, recommendedAnime, recommendationLoading, recommendationError),
    [library, recommendationError, recommendationLoading, recommendedAnime],
  )

  const selectedGroup = useMemo(
    () => selectedEntry ? libraryGroups.find((group) => group.entries.some((entry) => entry.id === selectedEntry.id)) || null : null,
    [libraryGroups, selectedEntry],
  )

  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()

    return libraryGroups
      .filter((group) => {
        const matchesStatus =
          statusFilter === 'all' ||
          group.entries.some((entry) => entry.status === statusFilter) ||
          (statusFilter === 'rewatch' && isGroupRewatchQueued(group)) ||
          (statusFilter === 'rewatching' && group.rewatchStatus === 'rewatching')
        const matchesQuery =
          !query ||
          group.title.toLowerCase().includes(query) ||
          group.entries.some(
            (entry) =>
              entry.title.toLowerCase().includes(query) ||
              entry.nativeTitle?.toLowerCase().includes(query) ||
              entry.genres.some((genre) => genre.toLowerCase().includes(query)) ||
              entry.studios.some((studio) => studio.toLowerCase().includes(query)),
          )

        return matchesStatus && matchesQuery
      })
      .sort((first, second) => {
        if (sortMode === 'title') return first.title.localeCompare(second.title)
        if (sortMode === 'rating') return (second.averageRating || 0) - (first.averageRating || 0)
        if (sortMode === 'progress') return groupProgressPercent(second) - groupProgressPercent(first)

        return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
      })
  }, [libraryGroups, libraryQuery, sortMode, statusFilter])

  const upcomingEntries = useMemo(
    () =>
      library
        .filter((entry) => entry.nextAiringEpisode?.airingAt && !['completed', 'dropped'].includes(entry.status))
        .sort((first, second) => {
          const firstDate = first.nextAiringEpisode?.airingAt || 0
          const secondDate = second.nextAiringEpisode?.airingAt || 0
          return firstDate - secondDate
        }),
    [library],
  )

  const continueEntries = useMemo(
    () =>
      library
        .filter((entry) => entry.status !== 'dropped' && (!entry.episodesTotal || entry.progress < entry.episodesTotal))
        .sort((first, second) => {
          const score = (entry: AnimeEntry) => {
            const statusScore = entry.status === 'watching' ? 500 : entry.status === 'paused' ? 260 : entry.status === 'planning' ? 120 : 0
            const progressScore = entry.progress > 0 ? 170 : 0
            const priorityScore = entry.priority === 'high' ? 90 : entry.priority === 'low' ? -30 : 0
            const recentDate = new Date(entry.lastWatchedAt || entry.updatedAt).getTime()
            const recentScore = Number.isFinite(recentDate) ? Math.max(0, 80 - Math.floor((Date.now() - recentDate) / 86_400_000)) : 0

            return statusScore + progressScore + priorityScore + recentScore
          }

          const scoreDiff = score(second) - score(first)
          if (scoreDiff) return scoreDiff

          return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
        })
        .slice(0, 6),
	    [library],
	  )

	  const sagePick = useMemo(
	    () =>
	      continueEntries[0] ||
      staleEntries[0] ||
      upcomingEntries[0] ||
      library.find((entry) => entry.priority === 'high') ||
      library.find((entry) => entry.status === 'planning') ||
      library[0],
	    [continueEntries, library, staleEntries, upcomingEntries],
	  )
  const notificationItems = useMemo<WatchNotification[]>(
    () => [
      ...staleEntries.map((entry) => {
        const quietDays = daysSince(activityDateFor(entry))
        const nextEpisode = Math.max(1, entry.progress + 1)
        const episodeTotal = entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''

        return {
          id: `stale-${entry.id}`,
          kind: 'stale' as const,
          entry,
          eyebrow: 'Stale watch',
          title: `${quietDays} days quiet`,
          description: `${entry.title} has not been updated since ${formatShortDate(activityDateFor(entry))}.`,
          meta: `Resume at Ep ${nextEpisode}${episodeTotal}`,
          actionLabel: 'Open title',
          icon: Clock3,
        }
      }),
      ...upcomingEntries.map((entry) => ({
        id: `upcoming-${entry.id}-${entry.nextAiringEpisode?.episode || 'next'}`,
        kind: 'upcoming' as const,
        entry,
        eyebrow: 'Airing soon',
        title: `Episode ${entry.nextAiringEpisode?.episode || 'next'}`,
        description: `${entry.title} airs ${formatDate(entry.nextAiringEpisode?.airingAt)}.`,
        meta: statusMeta[entry.status].label,
        actionLabel: 'Open title',
        icon: CalendarDays,
      })),
    ].filter((notification) => notificationAllowed(notification.entry, notification.id, notificationPreferences)),
    [notificationPreferences, staleEntries, upcomingEntries],
  )
  const notificationCount = Math.min(99, notificationItems.length)

  const openNotificationEntry = useCallback((entry: AnimeEntry) => {
    setSelectedId(entry.id)
    setView('library')
    setNotificationDrawerOpen(false)
    setAnimeChannelOpen(false)
  }, [])

  const dismissNotification = useCallback((id: string) => {
    setNotificationPreferences((current) => ({
      ...current,
      dismissedNotificationIds: [...new Set([...current.dismissedNotificationIds, id])],
    }))
  }, [])

  const snoozeNotification = useCallback((id: string) => {
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    setNotificationPreferences((current) => ({
      ...current,
      snoozedUntilById: {
        ...current.snoozedUntilById,
        [id]: snoozedUntil,
      },
    }))
  }, [])

  const muteNotificationEntry = useCallback((entry: AnimeEntry) => {
    setNotificationPreferences((current) => ({
      ...current,
      mutedAnimeIds: [...new Set([...current.mutedAnimeIds, entry.id])],
    }))
  }, [])

  const updateNotificationPreferences = useCallback((patch: Partial<NotificationPreferences>) => {
    setNotificationPreferences((current) => ({
      ...current,
      ...patch,
    }))
  }, [])

  const clearNotificationSilences = useCallback(() => {
    setNotificationPreferences((current) => ({
      ...current,
      mutedAnimeIds: [],
      dismissedNotificationIds: [],
      snoozedUntilById: {},
    }))
  }, [])

  const animeChannelEntries = useMemo(() => {
    const queueOrder = new Map(continueEntries.map((entry, index) => [entry.id, index]))

    return library
      .filter((entry) => entry.status === 'watching' && isUnfinishedEntry(entry))
      .sort((first, second) => {
        const firstOrder = queueOrder.get(first.id) ?? Number.MAX_SAFE_INTEGER
        const secondOrder = queueOrder.get(second.id) ?? Number.MAX_SAFE_INTEGER
        if (firstOrder !== secondOrder) return firstOrder - secondOrder

        return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
      })
  }, [continueEntries, library])

  const floatingWatchLabel = animeChannelEntries.length
    ? `Open anime channel: ${animeChannelEntries.length} watching`
    : 'Open anime channel'

  const openChannelEntry = useCallback((entry: AnimeEntry) => {
    setSelectedId(entry.id)
    setView('library')
    setAnimeChannelOpen(false)
    setNotificationDrawerOpen(false)
  }, [])

	  const trimmedSearchTerm = searchTerm.trim()
  const showSearchPanel =
    trimmedSearchTerm.length >= MIN_SEARCH_LENGTH &&
    (searching || searchResults.length > 0 || Boolean(searchError) || lastSearchTerm === trimmedSearchTerm)

  const executeSearch = useCallback(async (rawTerm: string) => {
    const term = rawTerm.trim()
    if (term.length < MIN_SEARCH_LENGTH) return

    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    const searchRunId = searchRunRef.current + 1
    searchRunRef.current = searchRunId

    setSearching(true)
    setSearchError('')

    try {
      const results = await searchAniList(term, controller.signal)
      if (searchRunRef.current !== searchRunId) return

      setSearchResults(results)
      setLastSearchTerm(term)
    } catch (error) {
      if (controller.signal.aborted || searchRunRef.current !== searchRunId) return

      setSearchError(error instanceof Error ? error.message : 'Search failed')
      setLastSearchTerm(term)
    } finally {
      if (searchRunRef.current === searchRunId) {
        setSearching(false)
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null
        }
      }
    }
  }, [])

  useEffect(() => {
    const term = searchTerm.trim()

    if (term.length < MIN_SEARCH_LENGTH) {
      searchAbortRef.current?.abort()
      searchAbortRef.current = null
      setSearching(false)
      setSearchError('')
      setLastSearchTerm('')
      setSearchResults([])
      return
    }

    setSearchError('')
    const timer = window.setTimeout(() => {
      void executeSearch(term)
    }, LIVE_SEARCH_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [executeSearch, searchTerm])

  const addHistory = (event: Omit<HistoryEvent, 'id' | 'at'>) => {
    setHistory((current) => [
      {
        ...event,
        id: createId(),
        at: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 500))
  }

  const updateEntry = (id: string, patch: Partial<AnimeEntry>, event?: Omit<HistoryEvent, 'id' | 'at'>) => {
    setLibrary((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    )

    if (event) addHistory(event)
  }

  const handleSearch = async () => {
    if (trimmedSearchTerm.length < MIN_SEARCH_LENGTH) {
      setSearchResults([])
      setLastSearchTerm('')
      setSearchError(`Type at least ${MIN_SEARCH_LENGTH} characters to search.`)
      return
    }

    await executeSearch(trimmedSearchTerm)
  }

  const clearSearch = () => {
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
    setSearchTerm('')
    setSearchResults([])
    setSearchError('')
    setSearching(false)
    setLastSearchTerm('')
  }

  const completedProgressFor = (result: SearchResult) => result.episodesTotal || 0

  const addFromSearch = (result: SearchResult, status: WatchStatus = 'planning', rewatchStatus: RewatchStatus = 'none') => {
    const existing = library.find((entry) => entry.anilistId === result.anilistId)
    if (existing) {
      if (status === 'completed') {
        markWatched(existing)
      }
      if (rewatchStatus !== 'none') {
        setRewatchStatus(existing, rewatchStatus)
      }
      setSelectedId(existing.id)
      setView('library')
      return
    }

    const now = new Date().toISOString()
    const completed = status === 'completed' || rewatchStatus !== 'none'
    const entry: AnimeEntry = {
      ...result,
      id: createId(),
      status: completed ? 'completed' : status,
      progress: completed ? completedProgressFor(result) : 0,
      rating: null,
      notes: '',
      addedAt: now,
      updatedAt: now,
      startedAt: status === 'watching' || completed ? now : undefined,
      completedAt: completed ? now : undefined,
      lastWatchedAt: completed ? now : undefined,
      rewatchStatus,
      rewatchPlannedAt: rewatchStatus === 'planned' ? now : undefined,
      rewatchStartedAt: rewatchStatus === 'rewatching' ? now : undefined,
      rewatchCount: rewatchStatus === 'rewatching' ? 1 : 0,
    }

    setLibrary((current) => [entry, ...current])
    setSelectedId(entry.id)
    setView('library')
    addHistory({
      animeId: entry.id,
      animeTitle: entry.title,
      type: 'added',
      message:
        rewatchStatus !== 'none'
          ? `Added to ${rewatchMeta[rewatchStatus].label}`
          : completed
            ? 'Marked as already watched'
            : `Added to ${statusMeta[status].label}`,
    })
  }

  function markWatched(entry: AnimeEntry) {
    if (entry.status === 'completed' && (!entry.episodesTotal || entry.progress >= entry.episodesTotal)) return

    const now = new Date().toISOString()
    const completedProgress = entry.episodesTotal || entry.progress
    const showEndCard = !isCompletedEntry(entry)

    updateEntry(
      entry.id,
      {
        status: 'completed',
        progress: completedProgress,
        startedAt: entry.startedAt || now,
        completedAt: now,
        lastWatchedAt: now,
      },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'status',
        message: 'Marked as already watched',
      },
    )

    if (showEndCard) {
      setEndCard({
        entry: {
          ...entry,
          status: 'completed',
          progress: completedProgress,
          completedAt: now,
          lastWatchedAt: now,
        },
        completedAt: now,
      })
    }
  }

  function setRewatchStatus(entry: AnimeEntry, rewatchStatus: Exclude<RewatchStatus, 'none'>) {
    if (entry.rewatchStatus === rewatchStatus) return

    const now = new Date().toISOString()
    const completedProgress = entry.episodesTotal || entry.progress
    const startingRewatch = rewatchStatus === 'rewatching'

    updateEntry(
      entry.id,
      {
        status: startingRewatch ? 'watching' : 'completed',
        progress: startingRewatch ? 0 : completedProgress,
        completedAt: entry.completedAt || now,
        lastWatchedAt: entry.lastWatchedAt || now,
        startedAt: entry.startedAt || now,
        rewatchStatus,
        rewatchPlannedAt: rewatchStatus === 'planned' ? now : entry.rewatchPlannedAt || now,
        rewatchStartedAt: startingRewatch ? now : entry.rewatchStartedAt,
        rewatchCount: startingRewatch ? (entry.rewatchCount || 0) + 1 : entry.rewatchCount || 0,
      },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'rewatch',
        message: `Marked as ${rewatchMeta[rewatchStatus].label}`,
      },
    )
  }

  function clearRewatchStatus(entry: AnimeEntry) {
    if (!isRewatchQueued(entry)) return

    updateEntry(
      entry.id,
      {
        status: entry.completedAt ? 'completed' : entry.status,
        progress: entry.completedAt && entry.episodesTotal ? entry.episodesTotal : entry.progress,
        rewatchStatus: 'none',
      },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'rewatch',
        message: 'Cleared rewatch plan',
      },
    )
  }

	  const changeProgress = (entry: AnimeEntry, nextProgress: number) => {
    const capped = entry.episodesTotal
      ? Math.min(entry.episodesTotal, Math.max(0, nextProgress))
      : Math.max(0, nextProgress)
    if (capped === entry.progress) return

    const now = new Date().toISOString()
    const completed = entry.episodesTotal ? capped >= entry.episodesTotal : false
    const nextStatus: WatchStatus = completed ? 'completed' : entry.status === 'planning' ? 'watching' : entry.status
    const showEndCard = completed && !isCompletedEntry(entry)

    setLastProgressChange({
      entryId: entry.id,
      animeTitle: entry.title,
      from: entry.progress,
      to: capped,
      previous: {
        progress: entry.progress,
        status: entry.status,
        lastWatchedAt: entry.lastWatchedAt,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      },
    })

    updateEntry(
      entry.id,
      {
        progress: capped,
        status: nextStatus,
        lastWatchedAt: capped > entry.progress ? now : entry.lastWatchedAt,
        startedAt: entry.startedAt || (capped > 0 ? now : undefined),
        completedAt: completed ? now : entry.completedAt,
      },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'progress',
        message: `Episode progress ${entry.progress} -> ${capped}`,
      },
	    )

    if (showEndCard) {
      setEndCard({
        entry: {
          ...entry,
          progress: capped,
          status: nextStatus,
          completedAt: now,
          lastWatchedAt: capped > entry.progress ? now : entry.lastWatchedAt,
        },
        completedAt: now,
      })
    }
	  }

  const undoProgress = (entry: AnimeEntry) => {
    if (!lastProgressChange || lastProgressChange.entryId !== entry.id) return

    updateEntry(
      entry.id,
      lastProgressChange.previous,
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'progress',
        message: `Undid progress ${lastProgressChange.to} -> ${lastProgressChange.from}`,
      },
    )
    setLastProgressChange(null)
  }

  const changeStatus = (entry: AnimeEntry, status: WatchStatus) => {
    if (entry.status === status) return

    const now = new Date().toISOString()
    const showEndCard = status === 'completed' && !isCompletedEntry(entry)
    updateEntry(
      entry.id,
      {
        status,
        startedAt: entry.startedAt || (status === 'watching' ? now : undefined),
        completedAt: status === 'completed' ? now : entry.completedAt,
      },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'status',
        message: `Moved to ${statusMeta[status].label}`,
      },
    )

    if (showEndCard) {
      setEndCard({
        entry: {
          ...entry,
          status: 'completed',
          completedAt: now,
        },
        completedAt: now,
      })
    }
  }

  const changeRating = (entry: AnimeEntry, rating: number) => {
    updateEntry(
      entry.id,
      { rating },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'rating',
        message: `Rated ${rating.toFixed(1)} / 10`,
      },
    )
  }

  const saveNotes = (entry: AnimeEntry, notes: string) => {
    updateEntry(
      entry.id,
      { notes },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'note',
        message: notes.trim() ? 'Updated notes' : 'Cleared notes',
      },
    )
  }

  const saveEpisodeMemo = (entry: AnimeEntry, episodeMemo: string) => {
    updateEntry(
      entry.id,
      { episodeMemo },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'note',
        message: episodeMemo.trim() ? 'Updated episode memory' : 'Cleared episode memory',
      },
    )
  }

  const toggleFavorite = (entry: AnimeEntry) => {
    updateEntry(
      entry.id,
      { favorite: !entry.favorite },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'label',
        message: entry.favorite ? 'Removed favorite label' : 'Marked as favorite',
      },
    )
  }

  const toggleRewatchWorthy = (entry: AnimeEntry) => {
    updateEntry(
      entry.id,
      { rewatchWorthy: !entry.rewatchWorthy },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'label',
        message: entry.rewatchWorthy ? 'Removed rewatch-worthy label' : 'Marked as rewatch-worthy',
      },
    )
  }

  const changePriority = (entry: AnimeEntry, priority: EntryPriority) => {
    updateEntry(
      entry.id,
      { priority },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'label',
        message: `Priority set to ${priorityMeta[priority].label}`,
      },
    )
  }

  const saveDroppedReason = (entry: AnimeEntry, droppedReason: string) => {
    updateEntry(
      entry.id,
      { droppedReason },
      {
        animeId: entry.id,
        animeTitle: entry.title,
        type: 'label',
        message: droppedReason.trim() ? 'Updated dropped reason' : 'Cleared dropped reason',
      },
    )
  }

  const removeEntry = (entry: AnimeEntry) => {
    const remove = window.confirm(`Remove ${entry.title} from your library?`)
    if (!remove) return

    setLibrary((current) => current.filter((item) => item.id !== entry.id))
    addHistory({
      animeId: entry.id,
      animeTitle: entry.title,
      type: 'removed',
      message: 'Removed from library',
    })
  }

  const refreshEntry = async (entry: AnimeEntry) => {
    setRefreshingId(entry.id)
    setDetailLoadingId(entry.id)
    setDetailError('')

    try {
      const patch = await fetchHydratedDetails(entry)
      updateEntry(
        entry.id,
        {
          ...patch,
        },
        {
          animeId: entry.id,
          animeTitle: patch.title || entry.title,
          type: 'refresh',
          message: 'Metadata refreshed',
        },
      )
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Refresh failed')
    } finally {
      setRefreshingId(null)
      setDetailLoadingId(null)
    }
  }

  const exportLibrary = () => {
    downloadStateSnapshot(library, history, 'gptnime-library')
  }

  const importLibrary = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const preview = parseImportPreview(text, file.name)
      setImportPreview(preview)
      setImportMode('merge')
    } catch {
      setSearchError('Import failed. Choose a GPTNime JSON export.')
    } finally {
      event.target.value = ''
    }
  }

  const applyImportPreview = () => {
    if (!importPreview) return

    downloadStateSnapshot(library, history, 'gptnime-backup-before-import')
    const importEvent: HistoryEvent = {
      id: createId(),
      animeTitle: 'Library import',
      type: 'import',
      message: `${importMode === 'merge' ? 'Merged' : 'Replaced with'} ${importPreview.library.length} titles from ${importPreview.fileName}`,
      at: new Date().toISOString(),
    }

    if (importMode === 'replace') {
      setLibrary(importPreview.library)
      setHistory([importEvent, ...importPreview.history].slice(0, 500))
    } else {
      setLibrary((current) => mergeLibraryEntries(current, importPreview.library))
      setHistory((current) => [importEvent, ...mergeHistoryEvents(current, importPreview.history)].slice(0, 500))
    }

    setImportPreview(null)
    setView('library')
  }

  const handleSageLogoClick = () => {
    window.clearTimeout(sageClickTimerRef.current)
    sageClickCountRef.current += 1

    if (sageClickCountRef.current >= 5) {
      sageClickCountRef.current = 0
      setSageMode((current) => !current)
      return
    }

    sageClickTimerRef.current = window.setTimeout(() => {
      sageClickCountRef.current = 0
    }, 1500)
  }

  const navigation = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: Flame },
    { id: 'library' as const, label: 'Library', icon: LibraryBig },
    { id: 'upcoming' as const, label: 'Upcoming', icon: Clock3 },
    { id: 'history' as const, label: 'History', icon: History },
  ]

  const lateNight = isLateNight(currentTime)
  const ambientSeason = ambientSeasonForDate(currentTime)
  const appClassName = [
    'app-shell',
    sageMode ? 'app-shell-sage' : '',
    lateNight ? 'app-shell-late' : '',
    `app-shell-${ambientSeason}`,
  ].filter(Boolean).join(' ')
  const staleNotificationCount = notificationItems.filter((notification) => notification.kind === 'stale').length
  const upcomingNotificationCount = notificationItems.filter((notification) => notification.kind === 'upcoming').length

  return (
    <div className={appClassName}>
      <aside className="sidebar">
        <div className="brand-block">
          <button
            className={[
              'brand-mark',
              sageMode ? 'brand-mark-sage' : '',
              brandPulse ? 'brand-mark-pulse' : '',
            ].filter(Boolean).join(' ')}
            type="button"
            title="GPTNime"
            aria-pressed={sageMode}
            onClick={handleSageLogoClick}
          >
            {sageMode ? <img src={TOAD_SAGE_IMAGE} alt="" /> : <Sparkles size={18} />}
          </button>
          <div>
            <p className="eyebrow">GPTNime</p>
            <h1>Watch Ledger</h1>
          </div>
        </div>

        <div className="art-card">
          <img className="art-card-bg" src={sageMode ? TOAD_SAGE_IMAGE : artPanels[1]} alt="" />
          <img className="art-card-image" src={sageMode ? TOAD_SAGE_IMAGE : artPanels[1]} alt="" />
          <div className="art-card-overlay">
            <span>{sageMode ? 'Sage mode' : `${stats.watching} active`}</span>
            <strong>{stats.nextUp ? `Ep ${stats.nextUp.nextAiringEpisode?.episode}` : sageMode ? 'Queue calm' : 'No queue'}</strong>
          </div>
        </div>

        <nav className="side-nav" aria-label="Primary">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-button nav-button-active' : 'nav-button'}
                type="button"
                onClick={() => setView(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="compact-stats">
          <Metric label="Titles" value={stats.total.toString()} />
          <Metric label="Episodes" value={stats.episodesWatched.toString()} />
          <Metric label="Avg score" value={stats.averageRating ? stats.averageRating.toFixed(1) : '-'} />
        </div>
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="search-panel">
            <Search size={18} />
            <input
              aria-label="Search AniList"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSearch()
              }}
              placeholder="Search anime on AniList"
            />
            {trimmedSearchTerm.length >= MIN_SEARCH_LENGTH && (
              <span className={searching ? 'live-search-badge live-search-badge-loading' : 'live-search-badge'}>
                {searching ? 'Searching' : 'Live'}
              </span>
            )}
            <button className="icon-text-button" type="button" onClick={() => void handleSearch()} disabled={searching}>
              {searching ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
              <span>Search</span>
            </button>
          </div>

	          <div className="topbar-actions">
	            <button
	              className={[
                  'icon-button notification-button',
                  notificationCount ? 'notification-button-active' : '',
                  notificationDrawerOpen ? 'notification-button-open' : '',
                ].filter(Boolean).join(' ')}
	              type="button"
	              title={notificationCount ? `${notificationCount} watch notification${notificationCount === 1 ? '' : 's'}` : 'No watch notifications'}
	              aria-label="Open watch notifications"
	              aria-controls="notification-drawer"
	              aria-expanded={notificationDrawerOpen}
	              onClick={() => setNotificationDrawerOpen(true)}
	            >
	              <Bell size={18} />
	              {notificationCount ? <span>{notificationCount}</span> : null}
	            </button>
	            <button className="icon-button" type="button" title="Export library" onClick={exportLibrary}>
	              <Download size={18} />
            </button>
            <button className="icon-button" type="button" title="Import library" onClick={() => importInputRef.current?.click()}>
              <Upload size={18} />
            </button>
            <input
              ref={importInputRef}
              className="hidden-file"
              type="file"
              accept="application/json"
              onChange={(event) => void importLibrary(event)}
            />
          </div>
        </header>

        <AnimatePresence>
          {showSearchPanel && (
            <motion.section
              className="search-results"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Discovery</p>
                  <h2>{lastSearchTerm ? `AniList results for ${lastSearchTerm}` : 'AniList results'}</h2>
                </div>
                <button className="icon-button" type="button" title="Clear search" onClick={clearSearch}>
                  <Trash2 size={16} />
                </button>
              </div>
              {searching && <p className="notice notice-live">Searching AniList...</p>}
              {searchError && <p className="notice notice-error">{searchError}</p>}
              {searchResults.length > 0 ? (
                <div className="result-strip">
                  {searchResults.map((result) => {
                    const trackedEntry = library.find((entry) => entry.anilistId === result.anilistId)
                    const rewatchLabel =
                      trackedEntry?.rewatchStatus && trackedEntry.rewatchStatus !== 'none'
                        ? rewatchMeta[trackedEntry.rewatchStatus].short
                        : null
                    const statusLabel = trackedEntry ? rewatchLabel || statusMeta[trackedEntry.status].short : null

                    return (
                      <article
                        className={`result-card${trackedEntry ? ' result-card-tracked' : ''}`}
                        key={result.anilistId}
                      >
                        <div className="result-cover">
                          <img src={result.coverImage || '/art/citadel.png'} alt={`${result.title} cover`} />
                        </div>
                        <div className="result-body">
                          <div className="result-copy">
                            <h3>{result.title}</h3>
                            <div className="result-kicker">
                              <p>{[result.format, result.seasonYear].filter(Boolean).join(' - ') || 'Anime'}</p>
                              {statusLabel ? <span className="result-status-pill">{statusLabel}</span> : null}
                            </div>
                            <div className="result-meta">
                              {result.episodesTotal ? <span>{result.episodesTotal} eps</span> : null}
                              {result.averageScore ? <span>{result.averageScore}%</span> : null}
                              {result.studios[0] ? <span>{result.studios[0]}</span> : null}
                            </div>
                          </div>
                          <div className="result-actions">
                            <button className="mini-button result-primary" type="button" onClick={() => addFromSearch(result, 'planning')}>
                              {trackedEntry ? <LibraryBig size={14} /> : <Plus size={14} />}
                              <span>{trackedEntry ? 'Open' : 'Plan'}</span>
                            </button>
                            <button className="mini-button result-primary strong" type="button" onClick={() => addFromSearch(result, 'watching')}>
                              <Play size={14} />
                              <span>Watch</span>
                            </button>
                            <button className="mini-button result-secondary seen" type="button" onClick={() => addFromSearch(result, 'completed')}>
                              <Check size={14} />
                              <span>Seen</span>
                            </button>
                            <button className="mini-button result-secondary rewatch" type="button" onClick={() => addFromSearch(result, 'completed', 'planned')}>
                              <RefreshCcw size={14} />
                              <span>Rewatch</span>
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
	              ) : (
	                lastSearchTerm === trimmedSearchTerm && !searching && !searchError && (
	                  <div className="search-empty-panel">
	                    <EmptyPanel image={TOAD_SAGE_IMAGE} title="No matches found" compact />
	                  </div>
	                )
	              )}
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.section
              key="dashboard"
              className="view-stack"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <Dashboard
                stats={stats}
                library={library}
	                history={history}
	                continueEntries={continueEntries}
	                staleEntries={staleEntries}
                collectionBadges={collectionBadges}
                fanStats={fanStats}
                smartShelves={smartShelves}
	                sageMode={sageMode}
	                sagePick={sagePick}
	                upcomingEntries={upcomingEntries}
                lateNight={lateNight}
	                setView={setView}
	                setSelectedId={setSelectedId}
                changeProgress={changeProgress}
                addFromSearch={addFromSearch}
              />
            </motion.section>
          )}

          {view === 'library' && (
            <motion.section
              key="library"
              className="view-stack"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <LibraryView
                entries={filteredLibrary}
                allCount={library.length}
                selectedEntry={selectedEntry}
                selectedGroup={selectedGroup}
                libraryQuery={libraryQuery}
                setLibraryQuery={setLibraryQuery}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                sortMode={sortMode}
                setSortMode={setSortMode}
                setSelectedId={setSelectedId}
                changeProgress={changeProgress}
                undoProgress={undoProgress}
                lastProgressChange={lastProgressChange}
                changeStatus={changeStatus}
                markWatched={markWatched}
                setRewatchStatus={setRewatchStatus}
                clearRewatchStatus={clearRewatchStatus}
                changeRating={changeRating}
                saveNotes={saveNotes}
                saveEpisodeMemo={saveEpisodeMemo}
                toggleFavorite={toggleFavorite}
                toggleRewatchWorthy={toggleRewatchWorthy}
                changePriority={changePriority}
                saveDroppedReason={saveDroppedReason}
                refreshEntry={refreshEntry}
                removeEntry={removeEntry}
                openFocusModal={() => setFocusModalOpen(true)}
                refreshingId={refreshingId}
                detailLoadingId={detailLoadingId}
                detailError={detailError}
              />
            </motion.section>
          )}

          {view === 'upcoming' && (
            <motion.section
              key="upcoming"
              className="view-stack"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <UpcomingView
                entries={upcomingEntries}
                setSelectedId={setSelectedId}
                setView={setView}
                changeProgress={changeProgress}
              />
            </motion.section>
          )}

          {view === 'history' && (
            <motion.section
              key="history"
              className="view-stack"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <HistoryView history={history} library={library} setSelectedId={setSelectedId} setView={setView} />
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {animeChannelOpen ? (
          <AnimeChannelPanel
            entries={animeChannelEntries}
            changeProgress={changeProgress}
            close={() => setAnimeChannelOpen(false)}
            onOpenEntry={openChannelEntry}
          />
        ) : (
          <motion.button
            className={animeChannelEntries.length ? 'anime-tv-fab' : 'anime-tv-fab anime-tv-fab-empty'}
            type="button"
            title={floatingWatchLabel}
            aria-label={floatingWatchLabel}
            aria-controls="anime-channel-panel"
            aria-expanded={animeChannelOpen}
            data-tooltip={floatingWatchLabel}
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.82 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setNotificationDrawerOpen(false)
              setAnimeChannelOpen(true)
            }}
          >
            <AnimeTvIcon />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notificationDrawerOpen && (
          <NotificationDrawer
            notifications={notificationItems}
            preferences={notificationPreferences}
            staleCount={staleNotificationCount}
            upcomingCount={upcomingNotificationCount}
            close={() => setNotificationDrawerOpen(false)}
            onOpenEntry={openNotificationEntry}
            onDismiss={dismissNotification}
            onSnooze={snoozeNotification}
            onMuteEntry={muteNotificationEntry}
            onUpdatePreferences={updateNotificationPreferences}
            onClearSilences={clearNotificationSilences}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {focusModalOpen && selectedEntry && (
          <AnimeFocusModal
            entry={selectedEntry}
            group={selectedGroup}
            setSelectedId={setSelectedId}
            changeProgress={changeProgress}
            undoProgress={undoProgress}
            lastProgressChange={lastProgressChange}
            markWatched={markWatched}
            changeRating={changeRating}
            toggleFavorite={toggleFavorite}
            toggleRewatchWorthy={toggleRewatchWorthy}
            changePriority={changePriority}
            saveDroppedReason={saveDroppedReason}
            refreshEntry={refreshEntry}
            refreshingId={refreshingId}
            layout={focusLayout}
            setLayout={setFocusLayout}
            close={() => setFocusModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {endCard && (
          <EndCardModal
            snapshot={endCard}
            close={() => setEndCard(null)}
            openLibrary={() => {
              setSelectedId(endCard.entry.id)
              setView('library')
              setEndCard(null)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importPreview && (
          <ImportPreviewModal
            preview={importPreview}
            mode={importMode}
            setMode={setImportMode}
            applyImport={applyImportPreview}
            close={() => setImportPreview(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ProgressTrack({
  entry,
  progress,
  total,
  className = '',
}: {
  entry?: AnimeEntry
  progress: number
  total?: number | null
  className?: string
}) {
  return (
    <div className={progressTrackClass(entry, className)} aria-hidden="true">
      <span style={{ width: `${progressPercentValue(progress, total)}%` }} />
      {progressMilestones(progress, total).map((milestone) => (
        <i
          className={milestone.reached ? 'progress-pip progress-pip-reached' : 'progress-pip'}
          key={milestone.id}
          title={milestone.label}
          style={{ left: `${milestone.left}%` }}
        />
      ))}
    </div>
  )
}

function AnimeTvIcon() {
  return (
    <svg className="anime-tv-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="anime-tv-frame" x1="12" x2="60" y1="16" y2="58">
          <stop offset="0" stopColor="#f4d889" />
          <stop offset="0.48" stopColor="#e14643" />
          <stop offset="1" stopColor="#3096a6" />
        </linearGradient>
        <radialGradient id="anime-tv-screen" cx="48%" cy="36%" r="64%">
          <stop offset="0" stopColor="#fff4d6" />
          <stop offset="0.34" stopColor="#69d4df" />
          <stop offset="1" stopColor="#171116" />
        </radialGradient>
      </defs>
      <path className="anime-tv-antenna" d="M28 17 18 7M44 17 55 6" />
      <path className="anime-tv-spark-large" d="M58 14 60 18l4 2-4 2-2 4-2-4-4-2 4-2Z" />
      <path className="anime-tv-frame" d="M14 19h44c4 0 7 3 7 7v26c0 4-3 7-7 7H14c-4 0-7-3-7-7V26c0-4 3-7 7-7Z" />
      <path className="anime-tv-screen" d="M17 27h34c2 0 4 2 4 4v16c0 2-2 4-4 4H17c-2 0-4-2-4-4V31c0-2 2-4 4-4Z" />
      <path className="anime-tv-shine" d="M19 31h15" />
      <path className="anime-tv-scan" d="M18 42c8-3 17-3 27 0" />
      <circle className="anime-tv-dial" cx="60" cy="33" r="3" />
      <circle className="anime-tv-dial anime-tv-dial-small" cx="60" cy="45" r="2" />
      <path className="anime-tv-foot" d="M23 63h26" />
    </svg>
  )
}

function AnimeChannelPanel({
  entries,
  changeProgress,
  close,
  onOpenEntry,
}: {
  entries: AnimeEntry[]
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  close: () => void
  onOpenEntry: (entry: AnimeEntry) => void
}) {
  const [tunedEntryId, setTunedEntryId] = useState<string | null>(null)
  const tunedEntry = useMemo(
    () => entries.find((entry) => entry.id === tunedEntryId) || null,
    [entries, tunedEntryId],
  )

  useEffect(() => {
    if (!tunedEntryId || entries.some((entry) => entry.id === tunedEntryId)) return
    setTunedEntryId(null)
  }, [entries, tunedEntryId])

  return (
    <motion.div
      className="anime-channel-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <motion.div
        id="anime-channel-panel"
        className={tunedEntry ? 'anime-channel-dock anime-channel-dock-tuned' : 'anime-channel-dock'}
        role="dialog"
        aria-modal="true"
        aria-label="Anime channel"
        initial={{ opacity: 0, x: 18, y: 18, scale: 0.18 }}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        exit={{ opacity: 0, x: 18, y: 18, scale: 0.18 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        style={{ transformOrigin: 'right bottom' }}
      >
        <aside className="anime-channel-panel">
          <header className="anime-channel-header">
            <span className="anime-channel-mark">
              <AnimeTvIcon />
            </span>
            <div>
              <p className="eyebrow">Anime channel</p>
              <h2>Watching now</h2>
              <span>{entries.length ? `${entries.length} active signal${entries.length === 1 ? '' : 's'}` : 'No active signal'}</span>
            </div>
            <button className="icon-button" type="button" title="Close anime channel" onClick={close}>
              <X size={18} />
            </button>
          </header>

          {entries.length ? (
            <div className="anime-channel-list">
              {entries.map((entry, index) => {
                const totalLabel = entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''
                const leftOffLabel = entry.progress > 0 ? `Left off Ep ${entry.progress}${totalLabel}` : 'Ready to start'
                const nextEpisodeLabel = `Next Ep ${Math.max(1, entry.progress + 1)}${totalLabel}`
                const tuned = tunedEntry?.id === entry.id

                return (
                  <button
                    className={tuned ? 'anime-channel-row anime-channel-row-tuned' : 'anime-channel-row'}
                    key={entry.id}
                    type="button"
                    title={`Tune to ${entry.title}`}
                    onClick={() => setTunedEntryId(entry.id)}
                  >
                    <img src={entry.coverImage || artPanels[index % artPanels.length]} alt={`${entry.title} cover`} />
                    <div className="anime-channel-copy">
                      <span className="anime-channel-kicker">
                        <Play size={14} />
                        <span>CH {String(index + 1).padStart(2, '0')}</span>
                      </span>
                      <strong>{entry.title}</strong>
                      <span className="anime-channel-episode-line">
                        <b>{leftOffLabel}</b>
                        <em>{nextEpisodeLabel}</em>
                      </span>
                      <ProgressTrack entry={entry} progress={entry.progress} total={entry.episodesTotal} />
                      <span className="anime-channel-meta">
                        <span className={statusClass(entry.status)}>{statusMeta[entry.status].short}</span>
                        <em>{formatShortDate(activityDateFor(entry))}</em>
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                )
              })}
            </div>
          ) : (
            <EmptyPanel image={TOAD_SAGE_IMAGE} title="No shows airing" compact />
          )}
        </aside>

        <AnimatePresence>
          {tunedEntry && (
            <AnimeChannelViewer
              entry={tunedEntry}
              channelNumber={entries.findIndex((entry) => entry.id === tunedEntry.id) + 1}
              nextQueueEntry={entries[(entries.findIndex((entry) => entry.id === tunedEntry.id) + 1) % entries.length]}
              changeProgress={changeProgress}
              close={() => setTunedEntryId(null)}
              tuneEntry={setTunedEntryId}
              openDetails={() => onOpenEntry(tunedEntry)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function AnimeChannelViewer({
  entry,
  channelNumber,
  nextQueueEntry,
  changeProgress,
  close,
  tuneEntry,
  openDetails,
}: {
  entry: AnimeEntry
  channelNumber: number
  nextQueueEntry?: AnimeEntry
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  close: () => void
  tuneEntry: (id: string) => void
  openDetails: () => void
}) {
  const nextEpisode = Math.max(1, entry.progress + 1)
  const totalLabel = entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''
  const leftOffLabel = entry.progress > 0 ? `Left off Episode ${entry.progress}${totalLabel}` : 'Ready to start'
  const nextEpisodeLabel = `Episode ${nextEpisode}${totalLabel}`
  const heroImage = entry.bannerImage || entry.coverImage || artPanels[0]
  const complete = Boolean(entry.episodesTotal && entry.progress >= entry.episodesTotal)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const subtitleObjectUrlRef = useRef<string | null>(null)
  const autoMarkedRef = useRef(false)
  const [localMedia, setLocalMedia] = useState<{ url: string; name: string } | null>(null)
  const [localSubtitle, setLocalSubtitle] = useState<{ url: string; name: string } | null>(null)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [compactPlayer, setCompactPlayer] = useState(false)
  const officialWatchLinks = officialWatchLinksFor(entry)
  const nextQueuedEntry = nextQueueEntry?.id === entry.id ? undefined : nextQueueEntry

  const clearLocalMedia = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (subtitleObjectUrlRef.current) {
      URL.revokeObjectURL(subtitleObjectUrlRef.current)
      subtitleObjectUrlRef.current = null
    }

    setLocalMedia(null)
    setLocalSubtitle(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (subtitleInputRef.current) subtitleInputRef.current.value = ''
  }, [])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    if (subtitleObjectUrlRef.current) URL.revokeObjectURL(subtitleObjectUrlRef.current)
  }, [])

  useEffect(() => {
    clearLocalMedia()
    autoMarkedRef.current = false
  }, [clearLocalMedia, entry.id])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed, localMedia])

  const selectLocalMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setLocalMedia({ url, name: file.name })
    autoMarkedRef.current = false
  }

  const selectLocalSubtitle = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (subtitleObjectUrlRef.current) URL.revokeObjectURL(subtitleObjectUrlRef.current)
    const url = URL.createObjectURL(file)
    subtitleObjectUrlRef.current = url
    setLocalSubtitle({ url, name: file.name })
  }

  const requestPictureInPicture = async () => {
    if (!videoRef.current || !document.pictureInPictureEnabled) return

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await videoRef.current.requestPictureInPicture()
      }
    } catch {
      // Browsers can reject PiP when the media has not started; keep this quiet.
    }
  }

  const handlePlaybackProgress = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    if (autoMarkedRef.current || complete) return

    if (video.currentTime / video.duration >= 0.9) {
      autoMarkedRef.current = true
      changeProgress(entry, entry.progress + 1)
    }
  }

  return (
    <motion.section
      className={compactPlayer ? 'anime-channel-viewer anime-channel-viewer-compact' : 'anime-channel-viewer'}
      initial={{ opacity: 0, x: -34, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, scale: 0.96 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{ '--viewer-art': `url(${heroImage})`, transformOrigin: 'left bottom' } as CSSProperties}
    >
      <header className="anime-channel-viewer-header">
        <div>
          <p className="eyebrow">GPTNime broadcast</p>
          <h2>{entry.title}</h2>
        </div>
        <button className="icon-button" type="button" title={compactPlayer ? 'Expand player' : 'Compact mini-player'} onClick={() => setCompactPlayer((current) => !current)}>
          {compactPlayer ? <Maximize2 size={18} /> : <Minus size={18} />}
        </button>
        <button className="icon-button" type="button" title="Close viewer" onClick={close}>
          <X size={18} />
        </button>
      </header>

      <div
        className={localMedia ? 'anime-channel-screen anime-channel-screen-player' : 'anime-channel-screen'}
        aria-label={`${entry.title} viewer`}
      >
        {localMedia && (
          <video
            ref={videoRef}
            className="anime-channel-video"
            src={localMedia.url}
            controls
            playsInline
            poster={heroImage}
            onTimeUpdate={handlePlaybackProgress}
          >
            {localSubtitle && <track src={localSubtitle.url} kind="subtitles" srcLang="en" label={localSubtitle.name} default />}
          </video>
        )}
        <div className="anime-channel-screen-overlay">
          <span className="anime-channel-live-pill">
            <Play size={13} />
            CH {String(Math.max(1, channelNumber)).padStart(2, '0')}
          </span>
          <span className={statusClass(entry.status)}>{statusMeta[entry.status].short}</span>
        </div>
        <div className="anime-channel-screen-copy">
          <span>{nextEpisodeLabel}</span>
          <strong>{entry.title}</strong>
          <em>{leftOffLabel}</em>
        </div>
        <div className="anime-channel-signal-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="anime-channel-viewer-body">
        <div className="anime-channel-source-panel">
          <div>
            <p className="eyebrow">Episode source</p>
            <strong>{localMedia ? localMedia.name : 'Choose a local episode file'}</strong>
            <span>{localMedia ? 'Playing from this browser session.' : 'Use a file or provider you have legal access to.'}</span>
          </div>
          <div className="anime-channel-source-actions">
            <button className="icon-text-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
              <span>{localMedia ? 'Replace file' : 'Choose file'}</span>
            </button>
            {localMedia && (
              <button className="icon-button" type="button" title="Clear selected file" onClick={clearLocalMedia}>
                <X size={16} />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            className="hidden-file"
            type="file"
            accept="video/*,.mkv,.webm,.mp4,.m4v,.mov"
            onChange={selectLocalMedia}
          />
          <input
            ref={subtitleInputRef}
            className="hidden-file"
            type="file"
            accept=".vtt,text/vtt"
            onChange={selectLocalSubtitle}
          />
          {officialWatchLinks.length ? (
            <div className="anime-channel-source-links">
              {officialWatchLinks.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>
                  <Link size={14} />
                  <span>{link.site}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="anime-channel-source-note">No official streaming providers were found in this title's metadata.</p>
          )}
        </div>

        <div className="anime-channel-playback-tools">
          <button className="mini-button" type="button" onClick={() => subtitleInputRef.current?.click()}>
            <Upload size={14} />
            <span>{localSubtitle ? localSubtitle.name : 'Add VTT subtitles'}</span>
          </button>
          <label className="playback-speed-control">
            <span>Speed</span>
            <select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}>
              {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </label>
          <button className="mini-button" type="button" onClick={() => void requestPictureInPicture()} disabled={!localMedia}>
            <Maximize2 size={14} />
            <span>PiP</span>
          </button>
          <span className="auto-watch-note">Local playback marks watched at 90%.</span>
        </div>

        <div className="anime-channel-viewer-progress">
          <span>
            <b>{leftOffLabel}</b>
            <em>{nextEpisodeLabel} queued</em>
          </span>
          <ProgressTrack entry={entry} progress={entry.progress} total={entry.episodesTotal} />
        </div>

        <div className="anime-channel-viewer-facts">
          <span>
            <b>{entry.format || 'TV'}</b>
            <em>Format</em>
          </span>
          <span>
            <b>{formatShortDate(activityDateFor(entry))}</b>
            <em>Last signal</em>
          </span>
          <span>
            <b>{entry.episodesTotal ? `${entry.progress}/${entry.episodesTotal}` : entry.progress.toString()}</b>
            <em>Progress</em>
          </span>
        </div>

        <div className="anime-channel-viewer-actions">
          <button
            className="icon-text-button strong"
            type="button"
            onClick={() => changeProgress(entry, entry.progress + 1)}
            disabled={complete}
          >
            <Check size={16} />
            <span>{complete ? 'Season complete' : 'Mark episode watched'}</span>
          </button>
          <button className="icon-text-button" type="button" onClick={openDetails}>
            <Maximize2 size={16} />
            <span>Open details</span>
          </button>
        </div>

        {nextQueuedEntry && (
          <button className="anime-channel-next-queue" type="button" onClick={() => tuneEntry(nextQueuedEntry.id)}>
            <img src={nextQueuedEntry.coverImage || artPanels[2]} alt="" />
            <span>
              <b>Next signal</b>
              <strong>{nextQueuedEntry.title}</strong>
              <em>{nextEpisodeLabelFor(nextQueuedEntry)}</em>
            </span>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </motion.section>
  )
}

function NotificationDrawer({
  notifications,
  preferences,
  staleCount,
  upcomingCount,
  close,
  onOpenEntry,
  onDismiss,
  onSnooze,
  onMuteEntry,
  onUpdatePreferences,
  onClearSilences,
}: {
  notifications: WatchNotification[]
  preferences: NotificationPreferences
  staleCount: number
  upcomingCount: number
  close: () => void
  onOpenEntry: (entry: AnimeEntry) => void
  onDismiss: (id: string) => void
  onSnooze: (id: string) => void
  onMuteEntry: (entry: AnimeEntry) => void
  onUpdatePreferences: (patch: Partial<NotificationPreferences>) => void
  onClearSilences: () => void
}) {
  return (
    <motion.div
      className="notification-drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <motion.aside
        id="notification-drawer"
        className="notification-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Watch notifications"
        initial={{ opacity: 0, x: 42 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 42 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <header className="notification-drawer-header">
          <div>
            <p className="eyebrow">Watch signals</p>
            <h2>Notifications</h2>
          </div>
          <button className="icon-button" type="button" title="Close notifications" onClick={close}>
            <X size={18} />
          </button>
        </header>

        <div className="notification-drawer-summary" aria-label="Notification summary">
          <span>
            <Clock3 size={15} />
            <strong>{staleCount}</strong>
            <em>quiet</em>
          </span>
          <span>
            <CalendarDays size={15} />
            <strong>{upcomingCount}</strong>
            <em>airing</em>
          </span>
        </div>

        <div className="notification-controls">
          <label className="notification-threshold">
            <span>Quiet after</span>
            <input
              type="number"
              min="3"
              max="120"
              value={preferences.staleDays}
              onChange={(event) => onUpdatePreferences({ staleDays: Number(event.target.value) || STALE_WATCH_DAYS })}
            />
            <em>days</em>
          </label>
          <label className="notification-toggle">
            <input
              type="checkbox"
              checked={preferences.onlyWatching}
              onChange={(event) => onUpdatePreferences({ onlyWatching: event.target.checked })}
            />
            <span>Watching only</span>
          </label>
          <label className="notification-toggle">
            <input
              type="checkbox"
              checked={preferences.onlyHighPriority}
              onChange={(event) => onUpdatePreferences({ onlyHighPriority: event.target.checked })}
            />
            <span>High priority only</span>
          </label>
          <button className="mini-button" type="button" onClick={onClearSilences}>
            <RefreshCcw size={14} />
            <span>Clear silences</span>
          </button>
        </div>

        {notifications.length ? (
          <div className="notification-list">
            {notifications.map((notification) => {
              const Icon = notification.icon

              return (
                <article
                  className={`notification-row notification-row-${notification.kind}`}
                  key={notification.id}
                  title={`${notification.eyebrow}: ${notification.entry.title}`}
                >
                  <img src={notification.entry.coverImage || artPanels[0]} alt={`${notification.entry.title} cover`} />
                  <div className="notification-row-copy">
                    <span className="notification-row-kicker">
                      <Icon size={15} />
                      <span>{notification.eyebrow}</span>
                    </span>
                    <strong>{notification.entry.title}</strong>
                    <span>{notification.title}</span>
                    <em>{notification.description}</em>
                    <ProgressTrack entry={notification.entry} progress={notification.entry.progress} total={notification.entry.episodesTotal} />
                  </div>
                  <span className="notification-row-meta">
                    <b>{notification.meta}</b>
                    <button type="button" onClick={() => onOpenEntry(notification.entry)}>
                      {notification.actionLabel}
                      <ChevronRight size={14} />
                    </button>
                  </span>
                  <div className="notification-row-actions">
                    <button type="button" onClick={() => onSnooze(notification.id)}>Snooze</button>
                    <button type="button" onClick={() => onDismiss(notification.id)}>Dismiss</button>
                    <button type="button" onClick={() => onMuteEntry(notification.entry)}>Mute title</button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyPanel image={TOAD_SAGE_IMAGE} title="No watch notifications" compact />
        )}
      </motion.aside>
    </motion.div>
  )
}

function ImportPreviewModal({
  preview,
  mode,
  setMode,
  applyImport,
  close,
}: {
  preview: ImportPreview
  mode: ImportMode
  setMode: (mode: ImportMode) => void
  applyImport: () => void
  close: () => void
}) {
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={close}
    >
      <motion.article
        className="import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import library preview"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="import-modal-header">
          <div>
            <p className="eyebrow">Import preview</p>
            <h2>{preview.fileName}</h2>
          </div>
          <button className="icon-button" type="button" title="Close import preview" onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="import-summary-grid">
          <Metric label="Titles" value={preview.library.length.toString()} />
          <Metric label="History" value={preview.history.length.toString()} />
          <Metric label="Skipped" value={preview.invalidCount.toString()} />
        </div>

        {preview.warnings.length ? (
          <div className="import-warning-list">
            {preview.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        <div className="import-mode-grid">
          <button className={mode === 'merge' ? 'import-mode-card import-mode-card-active' : 'import-mode-card'} type="button" onClick={() => setMode('merge')}>
            <strong>Merge</strong>
            <span>Add new titles and update matching AniList IDs.</span>
          </button>
          <button className={mode === 'replace' ? 'import-mode-card import-mode-card-active' : 'import-mode-card'} type="button" onClick={() => setMode('replace')}>
            <strong>Replace</strong>
            <span>Replace the current local library with this file.</span>
          </button>
        </div>

        <div className="import-modal-actions">
          <button className="icon-text-button" type="button" onClick={close}>
            <X size={16} />
            <span>Cancel</span>
          </button>
          <button className="icon-text-button strong" type="button" onClick={applyImport} disabled={!preview.library.length}>
            <Upload size={16} />
            <span>Backup and import</span>
          </button>
        </div>
      </motion.article>
    </motion.div>
  )
}

function EndCardModal({
  snapshot,
  close,
  openLibrary,
}: {
  snapshot: EndCardSnapshot
  close: () => void
  openLibrary: () => void
}) {
  const { entry, completedAt } = snapshot
  const runDays = entry.startedAt ? Math.max(1, daysSince(entry.startedAt)) : 1
  const scoreLabel = entry.rating ? `${entry.rating.toFixed(1)} / 10` : 'Unscored'
  const episodeLabel = entry.episodesTotal ? `${entry.episodesTotal} episodes` : `${entry.progress} logged`

  return (
    <motion.div
      className="end-card-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={close}
    >
      <motion.article
        className="end-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.title} completion card`}
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="end-card-art" style={{ '--end-card-art': `url(${entry.bannerImage || entry.coverImage || artPanels[0]})` } as CSSProperties}>
          <button className="icon-button" type="button" title="Close end card" onClick={close}>
            <X size={18} />
          </button>
          <span>End card</span>
          <h2>{entry.title}</h2>
          <p>Completed {formatShortDate(completedAt)}</p>
        </div>
        <div className="end-card-body">
          <div className="end-card-stats">
            <Fact label="Score" value={scoreLabel} />
            <Fact label="Run" value={episodeLabel} />
            <Fact label="Span" value={`${runDays} day${runDays === 1 ? '' : 's'}`} />
          </div>
          <p>
            Archive this run, add a score while it is fresh, or open the title to plan a rewatch.
          </p>
          <div className="end-card-actions">
            <button className="icon-text-button" type="button" onClick={close}>
              <Check size={16} />
              <span>Done</span>
            </button>
            <button className="icon-text-button strong" type="button" onClick={openLibrary}>
              <LibraryBig size={16} />
              <span>Open title</span>
            </button>
          </div>
        </div>
      </motion.article>
    </motion.div>
  )
}

function Dashboard({
  stats,
  library,
  history,
  continueEntries,
  staleEntries,
  collectionBadges,
  fanStats,
  smartShelves,
  sageMode,
  sagePick,
  upcomingEntries,
  lateNight,
  setView,
  setSelectedId,
  changeProgress,
  addFromSearch,
}: {
  stats: {
    total: number
    watching: number
    completed: number
    planning: number
    episodesWatched: number
    averageRating: number
    nextUp?: AnimeEntry
  }
  library: AnimeEntry[]
  history: HistoryEvent[]
  continueEntries: AnimeEntry[]
  staleEntries: AnimeEntry[]
  collectionBadges: CollectionBadge[]
  fanStats: FanStats
  smartShelves: SmartShelf[]
  sageMode: boolean
  sagePick?: AnimeEntry
  upcomingEntries: AnimeEntry[]
  lateNight: boolean
  setView: (view: ViewName) => void
  setSelectedId: (id: string) => void
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  addFromSearch: (result: SearchResult, status?: WatchStatus, rewatchStatus?: RewatchStatus) => void
}) {
  const recent = library.slice(0, 5)

  return (
    <>
      <section className={sageMode ? 'hero-panel hero-panel-sage' : 'hero-panel'}>
        <div className="hero-backdrop">
          <img src={sageMode ? TOAD_SAGE_IMAGE : artPanels[0]} alt="" />
        </div>
        <div className="hero-content">
          <p className="eyebrow">{sageMode ? 'Sage mode' : 'Library pulse'}</p>
          <h2>{sageMode ? 'Sage queue ready' : stats.watching ? `${stats.watching} shows in motion` : 'Start the watch list'}</h2>
          {lateNight && <p className="late-queue-note">Late queue warmed for quieter picks.</p>}
          <div className="hero-actions">
            <button className="icon-text-button strong" type="button" onClick={() => setView('library')}>
              <LibraryBig size={16} />
              <span>Library</span>
            </button>
            <button className="icon-text-button" type="button" onClick={() => setView('upcoming')}>
              <Clock3 size={16} />
              <span>Upcoming</span>
            </button>
          </div>
        </div>
        <div className="hero-showcase">
          <div className="hero-poster hero-poster-side">
            <img src={artPanels[1]} alt="" />
          </div>
          <div className="hero-poster hero-poster-main">
            <img src={sageMode ? TOAD_SAGE_IMAGE : artPanels[0]} alt="" />
          </div>
          <div className="hero-poster hero-poster-side">
            <img src={artPanels[2]} alt="" />
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <MetricTile label="Titles" value={stats.total.toString()} icon={LibraryBig} />
        <MetricTile label="Watching" value={stats.watching.toString()} icon={Play} />
        <MetricTile label="Completed" value={stats.completed.toString()} icon={Check} />
        <MetricTile label="Episodes" value={stats.episodesWatched.toString()} icon={Eye} />
      </section>

      <FanStatsPanel stats={fanStats} />

      <SmartShelvesPanel
        shelves={smartShelves}
        setSelectedId={setSelectedId}
        setView={setView}
        addFromSearch={addFromSearch}
      />

      <section className="dashboard-grid">
        <div className="panel wide-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Smart queue</p>
              <h2>Continue watching</h2>
            </div>
            <button className="icon-text-button" type="button" onClick={() => setView('library')}>
              <ListFilter size={16} />
              <span>Open</span>
            </button>
          </div>

          {continueEntries.length ? (
            <div className="active-list">
              {continueEntries.map((entry) => (
                <article className="active-row" key={entry.id}>
                  <img src={entry.coverImage || artPanels[2]} alt={`${entry.title} cover`} />
                  <div>
                    <h3>{entry.title}</h3>
                    <p>
                      Next ep {entry.progress + 1}
                      {entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''}
                    </p>
                    <ProgressTrack entry={entry} progress={entry.progress} total={entry.episodesTotal} />
                    <div className="continue-meta-row">
                      <span className={statusClass(entry.status)}>{statusMeta[entry.status].short}</span>
                      {entry.priority === 'high' && <span className="priority-chip priority-chip-high">High</span>}
                      {entry.favorite && <span className="priority-chip">Favorite</span>}
                    </div>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    title="Add one episode"
                    onClick={() => changeProgress(entry, entry.progress + 1)}
                  >
                    <Plus size={18} />
                  </button>
                </article>
	              ))}
	            </div>
	          ) : (
	            <EmptyPanel image={TOAD_SAGE_IMAGE} title="No unfinished titles" />
	          )}
	        </div>
	
	        <SageQueueCard
	          entry={sagePick}
            sageMode={sageMode}
	          setSelectedId={setSelectedId}
	          setView={setView}
	        />

	        <div className="panel">
	          <div className="section-heading">
	            <div>
              <p className="eyebrow">Next airing</p>
              <h2>Queue</h2>
            </div>
            <Clock3 size={19} />
          </div>
          {upcomingEntries[0] ? (
            <button
              className="next-card"
              style={{ '--next-cover': `url(${upcomingEntries[0].coverImage || artPanels[3]})` } as CSSProperties}
              type="button"
              onClick={() => {
                setSelectedId(upcomingEntries[0].id)
                setView('library')
              }}
            >
              <span>{formatDate(upcomingEntries[0].nextAiringEpisode?.airingAt)}</span>
              <strong>{upcomingEntries[0].title}</strong>
	              <em>Episode {upcomingEntries[0].nextAiringEpisode?.episode}</em>
	            </button>
	          ) : (
	            <EmptyPanel image={TOAD_SAGE_IMAGE} title="No airing dates" compact />
	          )}
	        </div>

        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent</p>
              <h2>Added</h2>
            </div>
            <Import size={19} />
          </div>
          {recent.length ? (
            <div className="mini-cover-row">
              {recent.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.title}
                  onClick={() => {
                    setSelectedId(entry.id)
                    setView('library')
                  }}
                >
                  <img src={entry.coverImage || artPanels[2]} alt={`${entry.title} cover`} />
                </button>
              ))}
	            </div>
	          ) : (
	            <EmptyPanel image={TOAD_SAGE_IMAGE} title="No titles yet" compact />
	          )}
	        </div>
	      </section>

	      <section className="dashboard-grid dashboard-grid-secondary">
	        <StaleWatchPanel
	          entries={staleEntries}
	          setSelectedId={setSelectedId}
	          setView={setView}
	          changeProgress={changeProgress}
	        />
	        <CollectionBadgesPanel badges={collectionBadges} />
	      </section>
	
	      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2>Latest activity</h2>
          </div>
          <History size={19} />
        </div>
        <Timeline events={history.slice(0, 6)} />
      </section>
    </>
	  )
	}

function FanStatsPanel({ stats }: { stats: FanStats }) {
  const maxHeat = Math.max(1, ...stats.monthHeatmap.map((item) => item.count))

  return (
    <section className="fan-stats-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Watch craft</p>
          <h2>Anime stats</h2>
        </div>
        <Eye size={19} />
      </div>
      <div className="fan-stat-grid">
        <MetricTile label="Completion" value={`${stats.completionRate}%`} icon={Check} />
        <MetricTile label="This month" value={stats.episodesThisMonth.toString()} icon={CalendarDays} />
        <MetricTile label="Rewatches" value={stats.rewatchCount.toString()} icon={RefreshCcw} />
        <MetricTile label="Films / Series" value={`${stats.movies}/${stats.series}`} icon={Play} />
      </div>
      <div className="stats-insight-grid">
        <div className="stats-card">
          <span>Month heatmap</span>
          <div className="month-heatmap">
            {stats.monthHeatmap.map((month) => (
              <i
                key={month.label}
                title={`${month.label}: ${month.count} activity events`}
                style={{ '--heat': `${0.18 + (month.count / maxHeat) * 0.82}` } as CSSProperties}
              >
                {month.label}
              </i>
            ))}
          </div>
        </div>
        <div className="stats-card">
          <span>Top genres</span>
          <div className="rank-list">
            {stats.topGenres.length ? stats.topGenres.map((item) => (
              <em key={item.label}>{item.label}<b>{item.count}</b></em>
            )) : <em>No genres yet<b>-</b></em>}
          </div>
        </div>
        <div className="stats-card">
          <span>Top studios</span>
          <div className="rank-list">
            {stats.topStudios.length ? stats.topStudios.map((item) => (
              <em key={item.label}>{item.label}<b>{item.count}</b></em>
            )) : <em>No studios yet<b>-</b></em>}
          </div>
        </div>
        <div className="stats-card">
          <span>Score by genre</span>
          <div className="rank-list">
            {stats.averageByGenre.length ? stats.averageByGenre.map((item) => (
              <em key={item.label}>{item.label}<b>{item.rating.toFixed(1)}</b></em>
            )) : <em>No scores yet<b>-</b></em>}
          </div>
        </div>
        <div className="stats-card stats-card-pause">
          <span>Longest pause</span>
          <strong>{stats.longestPause ? stats.longestPause.entry.title : 'No pause yet'}</strong>
          <em>{stats.longestPause ? `${stats.longestPause.days} days quiet` : 'Nothing stalled'}</em>
        </div>
      </div>
    </section>
  )
}

function SmartShelvesPanel({
  shelves,
  setSelectedId,
  setView,
  addFromSearch,
}: {
  shelves: SmartShelf[]
  setSelectedId: (id: string) => void
  setView: (view: ViewName) => void
  addFromSearch: (result: SearchResult, status?: WatchStatus, rewatchStatus?: RewatchStatus) => void
}) {
  if (!shelves.length) return null

  const recommendationShelf = shelves.find((shelf) => shelf.recommendations)
  const compactShelves = shelves.filter((shelf) => !shelf.recommendations)
  const recommendationCount = recommendationShelf?.recommendations?.length || 0

  return (
    <section className="smart-shelves-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Auto shelves</p>
          <h2>Smart shelves</h2>
        </div>
        <ListFilter size={19} />
      </div>

      {recommendationShelf && (
        <article className="smart-shelf-card smart-shelf-card-recommendations">
          <div className="smart-recommendation-intro">
            <span>
              {recommendationShelf.loading
                ? 'Tuning'
                : `${recommendationCount} title${recommendationCount === 1 ? '' : 's'}`}
            </span>
            <strong>{recommendationShelf.label}</strong>
            <p>{recommendationShelf.description}</p>
            <div className="recommendation-intro-art" aria-hidden="true">
              <img src="/art/recommendation-keeper.png" alt="" />
            </div>
          </div>

          <div className="smart-recommendation-list">
            {recommendationShelf.loading ? (
              <div className="smart-recommendation-state">
                <Loader2 size={16} />
                <span>Reading your strongest signals...</span>
              </div>
            ) : recommendationShelf.error ? (
              <div className="smart-recommendation-state smart-recommendation-state-error">
                <Info size={16} />
                <span>{recommendationShelf.error}</span>
              </div>
            ) : recommendationCount ? (
              recommendationShelf.recommendations?.slice(0, 3).map((recommendation) => (
                <div className="smart-recommendation-row" key={recommendation.anilistId}>
                  <img src={recommendation.coverImage || artPanels[2]} alt="" />
                  <div>
                    <strong>{recommendation.title}</strong>
                    <span>
                      {[
                        recommendation.format?.replace(/_/g, ' '),
                        formatSeason(recommendation) === '-' ? '' : formatSeason(recommendation),
                      ].filter(Boolean).join(' • ') || 'Anime'}
                    </span>
                    <p>
                      Based on {recommendation.recommendedFrom.slice(0, 2).join(', ')}
                      {recommendation.recommendedFrom.length > 2 ? ` +${recommendation.recommendedFrom.length - 2}` : ''}
                    </p>
                    <div className="smart-recommendation-tags">
                      {recommendation.genres.slice(0, 2).map((genre) => (
                        <em key={genre}>{genre}</em>
                      ))}
                      {(recommendation.averageScore || recommendation.meanScore) && (
                        <em>{recommendation.averageScore || recommendation.meanScore}%</em>
                      )}
                    </div>
                  </div>
                  <div className="smart-recommendation-actions">
                    <button className="mini-button" type="button" onClick={() => addFromSearch(recommendation, 'planning')}>
                      <CalendarDays size={13} />
                      <span>Plan</span>
                    </button>
                    <button className="mini-button result-primary strong" type="button" onClick={() => addFromSearch(recommendation, 'watching')}>
                      <Play size={13} />
                      <span>Watch</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="smart-recommendation-state">
                <Sparkles size={16} />
                <span>Rate or favorite a few titles to tune fresh picks.</span>
              </div>
            )}
          </div>
        </article>
      )}

      {compactShelves.length ? (
        <div className="smart-shelf-grid">
          {compactShelves.map((shelf) => (
            <article className="smart-shelf-card" key={shelf.id}>
              <div>
                <span>{shelf.entries.length} title{shelf.entries.length === 1 ? '' : 's'}</span>
                <strong>{shelf.label}</strong>
                <p>{shelf.description}</p>
              </div>

              <div className="smart-shelf-covers">
                {shelf.entries.slice(0, 4).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    title={entry.title}
                    onClick={() => {
                      setSelectedId(entry.id)
                      setView('library')
                    }}
                  >
                    <img src={entry.coverImage || artPanels[2]} alt="" />
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function SageQueueCard({
  entry,
  sageMode,
  setSelectedId,
  setView,
}: {
  entry?: AnimeEntry
  sageMode: boolean
  setSelectedId: (id: string) => void
  setView: (view: ViewName) => void
}) {
  const microcopy = entry
    ? sageMicrocopy[(entry.title.length + entry.progress) % sageMicrocopy.length]
    : sageMode
      ? 'Still water'
      : 'Queue is clear'

  return (
    <div className="panel sage-queue-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Mascot pick</p>
          <h2>Sage Queue</h2>
        </div>
        <Sparkles size={19} />
      </div>
      <button
        className="sage-pick-card"
        type="button"
        disabled={!entry}
        onClick={() => {
          if (!entry) return
          setSelectedId(entry.id)
          setView('library')
        }}
      >
        <img src={TOAD_SAGE_IMAGE} alt="" />
        <span>{microcopy}</span>
        <strong>{entry?.title || 'No title waiting'}</strong>
        {entry ? (
          <em>
            Ep {entry.progress + 1}
            {entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''}
          </em>
        ) : null}
      </button>
    </div>
  )
}

function StaleWatchPanel({
  entries,
  setSelectedId,
  setView,
  changeProgress,
}: {
  entries: AnimeEntry[]
  setSelectedId: (id: string) => void
  setView: (view: ViewName) => void
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
}) {
  return (
    <div className="panel stale-watch-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Stale watch nudge</p>
          <h2>21+ days quiet</h2>
        </div>
        <Clock3 size={19} />
      </div>
      {entries.length ? (
        <div className="stale-watch-list">
          {entries.map((entry) => (
            <article className="stale-watch-row" key={entry.id}>
              <img src={entry.coverImage || TOAD_SAGE_IMAGE} alt={`${entry.title} cover`} />
              <div>
                <h3>{entry.title}</h3>
                <p>
                  {daysSince(activityDateFor(entry))} days since update
                  {entry.episodesTotal ? ` - ${entry.progress}/${entry.episodesTotal}` : ` - Ep ${entry.progress}`}
                </p>
              </div>
              <div className="stale-watch-actions">
                <button
                  className="mini-icon-button"
                  type="button"
                  title="Open title"
                  onClick={() => {
                    setSelectedId(entry.id)
                    setView('library')
                  }}
                >
                  <LibraryBig size={15} />
                </button>
                <button className="mini-icon-button strong" type="button" title="Add one episode" onClick={() => changeProgress(entry, entry.progress + 1)}>
                  <Plus size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyPanel image={TOAD_SAGE_IMAGE} title="No stale titles" compact />
      )}
    </div>
  )
}

function CollectionBadgesPanel({ badges }: { badges: CollectionBadge[] }) {
  const unlockedCount = badges.filter((badge) => badge.count > 0).length
  const [activeBadgeId, setActiveBadgeId] = useState<CollectionBadgeId | null>(null)

  return (
    <div className="panel collection-badges-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Collection badges</p>
          <h2>{unlockedCount} unlocked</h2>
        </div>
        <Star size={19} />
      </div>
      <div className="badge-art-card">
        {badges.map((badge, index) => {
          const unlocked = badge.count > 0
          const active = activeBadgeId === badge.id
          const tooltip = unlocked ? `${badge.label}: ${badge.description}` : 'Mystery badge: unlock to reveal'

          return (
            <button
              className={[
                'badge-showcase-item',
                unlocked ? 'badge-showcase-item-unlocked' : 'badge-showcase-item-locked',
                active ? 'badge-showcase-item-active' : '',
              ].filter(Boolean).join(' ')}
              data-tooltip={tooltip}
              key={badge.id}
              type="button"
              title={tooltip}
              aria-label={tooltip}
              disabled={!unlocked}
              style={{ '--badge-position': `${index * 25}%` } as CSSProperties}
              onMouseEnter={() => unlocked && setActiveBadgeId(badge.id)}
              onMouseLeave={() => setActiveBadgeId(null)}
              onFocus={() => unlocked && setActiveBadgeId(badge.id)}
              onBlur={() => setActiveBadgeId(null)}
            >
              {unlocked ? (
                <span className="badge-showcase-image" />
              ) : (
                <span className="badge-showcase-mystery">
                  <Sparkles size={16} />
                  <b>?</b>
                </span>
              )}
              <em>{unlocked ? badge.label : 'Mystery'}</em>
            </button>
          )
        })}
      </div>
      <div className="collection-badge-grid">
        {badges.map((badge) => {
          const Icon = badge.icon
          const unlocked = badge.count > 0
          const active = activeBadgeId === badge.id
          const tooltip = unlocked ? `${badge.label}: ${badge.description}` : 'Mystery badge: unlock to reveal'

          return (
            <article
              className={[
                'collection-badge',
                unlocked ? 'collection-badge-unlocked' : 'collection-badge-locked',
                active ? 'collection-badge-highlighted' : '',
              ].filter(Boolean).join(' ')}
              data-tooltip={tooltip}
              key={badge.id}
              title={tooltip}
              tabIndex={unlocked ? 0 : undefined}
              onMouseEnter={() => unlocked && setActiveBadgeId(badge.id)}
              onMouseLeave={() => setActiveBadgeId(null)}
              onFocus={() => unlocked && setActiveBadgeId(badge.id)}
              onBlur={() => setActiveBadgeId(null)}
            >
              <span>
                {unlocked ? <Icon size={16} /> : <b className="locked-row-mark">?</b>}
              </span>
              <div>
                <strong>{unlocked ? badge.label : 'Mystery badge'}</strong>
                <em>{unlocked ? badge.description : 'Unlock to reveal'}</em>
              </div>
              <b>{unlocked ? badge.count : '-'}</b>
            </article>
          )
        })}
      </div>
    </div>
  )
}
	
	function MetricTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof LibraryBig
}) {
  return (
    <div className="metric-tile">
      <Icon size={19} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EpisodeJumpControl({
  entry,
  changeProgress,
  className = '',
}: {
  entry: AnimeEntry
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  className?: string
}) {
  const [draftEpisode, setDraftEpisode] = useState(entry.progress.toString())
  const maxEpisode = entry.episodesTotal || undefined

  useEffect(() => {
    setDraftEpisode(entry.progress.toString())
  }, [entry.id, entry.progress])

  const parsedEpisode = Number(draftEpisode)
  const normalizedEpisode = Number.isFinite(parsedEpisode)
    ? Math.floor(maxEpisode ? Math.min(maxEpisode, Math.max(0, parsedEpisode)) : Math.max(0, parsedEpisode))
    : entry.progress
  const canUpdate = draftEpisode.trim() !== '' && normalizedEpisode !== entry.progress

  const updateLeftOffEpisode = () => {
    if (!draftEpisode.trim()) return
    changeProgress(entry, normalizedEpisode)
    setDraftEpisode(normalizedEpisode.toString())
  }

  return (
    <form
      className={`episode-jump-control${className ? ` ${className}` : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        updateLeftOffEpisode()
      }}
    >
      <label>
        <span>Left off at</span>
        <div className="episode-jump-field">
          <input
            aria-label={`Episode left off at for ${entry.title}`}
            inputMode="numeric"
            min="0"
            max={maxEpisode}
            step="1"
            type="number"
            value={draftEpisode}
            onChange={(event) => setDraftEpisode(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
          {maxEpisode ? <em>/ {maxEpisode}</em> : null}
        </div>
      </label>
      <button className="episode-jump-button" type="submit" disabled={!canUpdate}>
        <Check size={16} />
        <span>Update</span>
      </button>
    </form>
  )
}

function parseEpisodeRangeEnd(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const rangeMatch = trimmed.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i)
  if (rangeMatch) return Number(rangeMatch[2])

  const singleMatch = trimmed.match(/^\d+$/)
  return singleMatch ? Number(trimmed) : null
}

function BulkEpisodeTools({
  entry,
  changeProgress,
  undoProgress,
  canUndo,
}: {
  entry: AnimeEntry
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  undoProgress: (entry: AnimeEntry) => void
  canUndo: boolean
}) {
  const [rangeDraft, setRangeDraft] = useState('')
  const completeDisabled = !entry.episodesTotal || entry.progress >= entry.episodesTotal

  const applyRange = () => {
    const end = parseEpisodeRangeEnd(rangeDraft)
    if (end === null) return

    changeProgress(entry, end)
    setRangeDraft('')
  }

  return (
    <section className="bulk-tools" aria-label={`Bulk episode tools for ${entry.title}`}>
      <div className="bulk-tools-heading">
        <Check size={16} />
        <span>Bulk tools</span>
      </div>
      <div className="bulk-action-grid">
        <button className="bulk-tool-button strong" type="button" onClick={() => changeProgress(entry, entry.episodesTotal || entry.progress)} disabled={completeDisabled}>
          <Check size={16} />
          <span>Complete season</span>
        </button>
        <button className="bulk-tool-button" type="button" onClick={() => changeProgress(entry, 0)} disabled={entry.progress === 0}>
          <RefreshCcw size={16} />
          <span>Reset progress</span>
        </button>
        <button className="bulk-tool-button" type="button" onClick={() => undoProgress(entry)} disabled={!canUndo}>
          <RefreshCcw size={16} />
          <span>Undo last</span>
        </button>
      </div>
      <form
        className="range-tool"
        onSubmit={(event) => {
          event.preventDefault()
          applyRange()
        }}
      >
        <label>
          <span>Mark range watched</span>
          <input
            aria-label={`Episode range watched for ${entry.title}`}
            placeholder="5-12"
            value={rangeDraft}
            onChange={(event) => setRangeDraft(event.target.value)}
          />
        </label>
        <button className="bulk-tool-button strong" type="submit" disabled={parseEpisodeRangeEnd(rangeDraft) === null}>
          <Check size={16} />
          <span>Apply</span>
        </button>
      </form>
    </section>
  )
}

function EpisodeMemoryPanel({
  entry,
  saveEpisodeMemo,
}: {
  entry: AnimeEntry
  saveEpisodeMemo: (entry: AnimeEntry, memo: string) => void
}) {
  const [draftMemo, setDraftMemo] = useState(entry.episodeMemo || '')

  useEffect(() => {
    setDraftMemo(entry.episodeMemo || '')
  }, [entry.id, entry.episodeMemo])

  return (
    <section className="episode-memory-panel">
      <div className="episode-memory-heading">
        <Clock3 size={16} />
        <span>Episode memory</span>
      </div>
      <div className="episode-memory-grid">
        <span>
          <b>{lastWatchedLabelFor(entry)}</b>
          <em>Last signal</em>
        </span>
        <span>
          <b>{isUnfinishedEntry(entry) ? nextEpisodeLabelFor(entry) : 'Complete'}</b>
          <em>Next up</em>
        </span>
      </div>
      <label>
        <span>My recap</span>
        <textarea
          value={draftMemo}
          onChange={(event) => setDraftMemo(event.target.value)}
          onBlur={() => saveEpisodeMemo(entry, draftMemo)}
          rows={3}
          placeholder="Thread to remember before the next episode"
        />
      </label>
    </section>
  )
}

function EntryProfileControls({
  entry,
  group,
  changeRating,
  toggleFavorite,
  toggleRewatchWorthy,
  changePriority,
  saveDroppedReason,
  showRating = false,
}: {
  entry: AnimeEntry
  group: LibraryGroup | null
  changeRating: (entry: AnimeEntry, rating: number) => void
  toggleFavorite: (entry: AnimeEntry) => void
  toggleRewatchWorthy: (entry: AnimeEntry) => void
  changePriority: (entry: AnimeEntry, priority: EntryPriority) => void
  saveDroppedReason: (entry: AnimeEntry, reason: string) => void
  showRating?: boolean
}) {
  const [draftDroppedReason, setDraftDroppedReason] = useState(entry.droppedReason || '')

  useEffect(() => {
    setDraftDroppedReason(entry.droppedReason || '')
  }, [entry.id, entry.droppedReason])

  const favoriteClassName = [
    'profile-toggle',
    'profile-toggle-favorite',
    entry.favorite ? 'profile-toggle-active' : '',
    hasPerfectFavorite(entry) ? 'perfect-favorite-glint' : '',
  ].filter(Boolean).join(' ')
  const rewatchClassName = [
    'profile-toggle',
    'profile-toggle-rewatch',
    entry.rewatchWorthy ? 'profile-toggle-active' : '',
  ].filter(Boolean).join(' ')
  const groupFavoriteCount = group?.entries.filter((item) => item.favorite).length || 0
  const profileSummary = group && group.entries.length > 1
    ? `${groupFavoriteCount}/${group.entries.length} favorited in run`
    : entry.favorite
      ? 'Favorited'
      : 'Not favorited'

  return (
    <section className="entry-profile-panel">
      <div className="entry-profile-heading">
        <Star size={16} />
        <span>Watch profile</span>
        {group?.averageRating ? <em>Group avg {group.averageRating.toFixed(1)}</em> : null}
      </div>
      <div className="entry-profile-summary">
        <span>{entry.favorite ? 'This entry is favorited' : 'This entry is not favorited'}</span>
        <em>{profileSummary}</em>
      </div>
      {showRating && (
        <label className="profile-rating-control">
          <span>Your score</span>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={entry.rating || 0}
            onChange={(event) => changeRating(entry, Number(event.target.value))}
          />
          <strong>{entry.rating ? entry.rating.toFixed(1) : '-'}</strong>
        </label>
      )}
      <div className="profile-toggle-row">
        <button
          className={favoriteClassName}
          type="button"
          aria-pressed={Boolean(entry.favorite)}
          title={entry.favorite ? 'Remove favorite from this entry' : 'Mark this entry as favorite'}
          onClick={() => toggleFavorite(entry)}
        >
          <Star size={15} />
          <span>{entry.favorite ? 'Favorited' : 'Favorite'}</span>
        </button>
        <button
          className={rewatchClassName}
          type="button"
          aria-pressed={Boolean(entry.rewatchWorthy)}
          title={entry.rewatchWorthy ? 'Remove rewatch-worthy from this entry' : 'Mark this entry as rewatch-worthy'}
          onClick={() => toggleRewatchWorthy(entry)}
        >
          <RefreshCcw size={15} />
          <span>Rewatch-worthy</span>
        </button>
      </div>
      <label className="profile-priority-control">
        <span>Priority</span>
        <div className="select-control">
          <Flame size={16} />
          <select value={entry.priority || 'normal'} onChange={(event) => changePriority(entry, event.target.value as EntryPriority)}>
            {Object.entries(priorityMeta).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
      </label>
      {(entry.status === 'dropped' || entry.droppedReason) && (
        <label className="dropped-reason-control">
          <span>Dropped reason</span>
          <textarea
            value={draftDroppedReason}
            onChange={(event) => setDraftDroppedReason(event.target.value)}
            onBlur={() => saveDroppedReason(entry, draftDroppedReason)}
            rows={3}
          />
        </label>
      )}
    </section>
  )
}

function AnimeFocusModal({
  entry,
  group,
  setSelectedId,
  changeProgress,
  undoProgress,
  lastProgressChange,
  markWatched,
  changeRating,
  toggleFavorite,
  toggleRewatchWorthy,
  changePriority,
  saveDroppedReason,
  refreshEntry,
  refreshingId,
  layout,
  setLayout,
  close,
}: {
  entry: AnimeEntry
  group: LibraryGroup | null
  setSelectedId: (id: string) => void
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  undoProgress: (entry: AnimeEntry) => void
  lastProgressChange: ProgressUndoSnapshot | null
  markWatched: (entry: AnimeEntry) => void
  changeRating: (entry: AnimeEntry, rating: number) => void
  toggleFavorite: (entry: AnimeEntry) => void
  toggleRewatchWorthy: (entry: AnimeEntry) => void
  changePriority: (entry: AnimeEntry, priority: EntryPriority) => void
  saveDroppedReason: (entry: AnimeEntry, reason: string) => void
  refreshEntry: (entry: AnimeEntry) => Promise<void>
  refreshingId: string | null
  layout: FocusLayout
  setLayout: (layout: FocusLayout) => void
  close: () => void
}) {
  const episodes = episodeRowsFor(entry)
  const currentSeasonIndex = group ? Math.max(0, group.entries.findIndex((season) => season.id === entry.id)) : 0
  const heroImage = entry.bannerImage || entry.coverImage || artPanels[0]
  const seasonLabel = group ? seasonLabelFor(entry, group, currentSeasonIndex) : formatSeason(entry)
  const tagList = entry.tags?.length ? entry.tags.slice(0, 18).map((tag) => tag.name) : entry.genres
  const progressLabel = `${entry.progress}${entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''}`

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [close])

  return (
    <motion.div
      className="focus-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={close}
    >
      <motion.article
        className={`focus-modal focus-modal-${layout}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.title} focused details`}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="focus-modal-hero" style={{ '--focus-hero': `url(${heroImage})` } as CSSProperties}>
          <div className="focus-modal-actions">
            <button
              className="icon-button"
              type="button"
              title={layout === 'cinematic' ? 'Use compact modal layout' : 'Use cinematic modal layout'}
              onClick={() => setLayout(layout === 'cinematic' ? 'compact' : 'cinematic')}
            >
              <ListFilter size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Refresh metadata"
              onClick={() => void refreshEntry(entry)}
              disabled={refreshingId === entry.id}
            >
              {refreshingId === entry.id ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            </button>
            <button className="icon-button" type="button" title="Close focused view" onClick={close}>
              <X size={18} />
            </button>
          </div>

          <div className="focus-modal-hero-copy">
            <img className="focus-cover" src={entry.coverImage || artPanels[2]} alt={`${entry.title} cover`} />
            <div className="focus-title-stack">
              <div className="focus-pill-row">
                <span className={statusClass(entry.status)}>{statusMeta[entry.status].short}</span>
                {isRewatchQueued(entry) && (
                  <span className={rewatchClass(entry.rewatchStatus)}>
                    <RefreshCcw size={13} />
                    {rewatchMeta[entry.rewatchStatus as Exclude<RewatchStatus, 'none'>].short}
                  </span>
                )}
              </div>
              <h2>{entry.title}</h2>
              <p>{[entry.format, entry.seasonYear, entry.source].filter(Boolean).join(' - ')}</p>
              <div className="focus-progress-summary">
                <span>{seasonLabel}</span>
                <strong>Episodes {progressLabel}</strong>
                <ProgressTrack entry={entry} progress={entry.progress} total={entry.episodesTotal} />
              </div>
              <div className="focus-quick-actions">
                <button className="mini-icon-button" type="button" title="Previous episode" onClick={() => changeProgress(entry, entry.progress - 1)}>
                  <Minus size={15} />
                </button>
                <button className="mini-icon-button strong" type="button" title="Next episode" onClick={() => changeProgress(entry, entry.progress + 1)}>
                  <Plus size={15} />
                </button>
                <button className="mark-watched-button" type="button" onClick={() => markWatched(entry)}>
                  <Check size={17} />
                  <span>Mark watched</span>
                </button>
              </div>
              <EpisodeJumpControl entry={entry} changeProgress={changeProgress} className="focus-jump-control" />
              <BulkEpisodeTools
                entry={entry}
                changeProgress={changeProgress}
                undoProgress={undoProgress}
                canUndo={lastProgressChange?.entryId === entry.id}
              />
            </div>
          </div>
        </header>

        <div className="focus-modal-content">
          {group && group.entries.length > 1 && (
            <section className="season-switcher focus-season-switcher" aria-label={`${group.title} seasons in library`}>
              <div className="season-switcher-heading">
                <LibraryBig size={16} />
                <span>{group.entries.length} seasons in library</span>
              </div>
              <div className="season-tab-list">
                {group.entries.map((season, index) => {
                  const active = season.id === entry.id
                  return (
                    <button
                      className={active ? 'season-tab season-tab-active' : 'season-tab'}
                      key={season.id}
                      type="button"
                      onClick={() => setSelectedId(season.id)}
                    >
                      <img src={season.coverImage || artPanels[2]} alt="" />
                      <span>
                        <strong>{seasonLabelFor(season, group, index)}</strong>
                        <em>{season.title}</em>
                      </span>
                      <b>
                        {season.progress}
                        {season.episodesTotal ? `/${season.episodesTotal}` : ''}
                      </b>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <EntryProfileControls
            entry={entry}
            group={group}
            changeRating={changeRating}
            toggleFavorite={toggleFavorite}
            toggleRewatchWorthy={toggleRewatchWorthy}
            changePriority={changePriority}
            saveDroppedReason={saveDroppedReason}
            showRating
          />

          <div className="focus-overview-grid">
            <section className="info-section focus-overview">
              <div className="info-section-title">
                <Info size={17} />
                <h3>Overview</h3>
              </div>
              {entry.description ? <p>{entry.description}</p> : <p className="detail-muted">No synopsis available.</p>}
              <div className="tag-row">
                {entry.genres.slice(0, 8).map((genre) => (
                  <span key={genre}>{genre}</span>
                ))}
              </div>
            </section>

            <section className="info-section">
              <div className="info-section-title">
                <Sparkles size={17} />
                <h3>Details</h3>
              </div>
              <div className="fact-grid">
                <Fact label="Episodes" value={entry.episodesTotal ? entry.episodesTotal.toString() : 'Unknown'} />
                <Fact label="Duration" value={entry.duration ? `${entry.duration} min` : '-'} />
                <Fact label="Season" value={formatSeason(entry)} />
                <Fact label="Score" value={entry.averageScore ? `${entry.averageScore}%` : '-'} />
                <Fact label="Mean" value={entry.meanScore ? `${entry.meanScore}%` : '-'} />
                <Fact label="Popularity" value={formatNumber(entry.popularity)} />
                <Fact label="Source" value={entry.source || '-'} />
                <Fact label="Country" value={entry.countryOfOrigin || '-'} />
              </div>
              {entry.rankings?.length ? (
                <div className="ranking-row">
                  {entry.rankings.slice(0, 4).map((ranking) => (
                    <span key={`${ranking.type}-${ranking.rank}-${ranking.context}`}>
                      #{ranking.rank} {ranking.context || ranking.type?.toLowerCase()}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          <section className="info-section">
            <div className="info-section-title">
              <Check size={17} />
              <h3>Episodes</h3>
            </div>
            {episodes.length ? (
              <div className="episode-list focus-episode-list">
                {episodes.map((episode) => {
                  const watched = episode.number <= entry.progress
                  return (
                    <button
                      className={watched ? 'episode-row episode-row-watched' : 'episode-row'}
                      key={episode.number}
                      type="button"
                      onClick={() => changeProgress(entry, episode.number)}
                    >
                      <span className="episode-number">{episode.number}</span>
                      <span className="episode-copy">
                        <strong>{episode.title}</strong>
                        <em>
                          {[formatEpisodeDate(episode.aired), episode.filler ? 'Filler' : '', episode.recap ? 'Recap' : '']
                            .filter(Boolean)
                            .join(' - ')}
                        </em>
                      </span>
                      <span className="episode-state">{watched ? 'Watched' : 'Mark'}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="detail-muted">Episode list unavailable for this title.</p>
            )}
          </section>

          <div className="focus-secondary-grid">
            {entry.staff?.length ? (
              <section className="info-section">
                <div className="info-section-title">
                  <Users size={17} />
                  <h3>Staff</h3>
                </div>
                <div className="credit-list">
                  {entry.staff.slice(0, 8).map((credit) => (
                    <a className="credit-row" href={credit.siteUrl || '#'} key={`${credit.id}-${credit.role}`} target="_blank" rel="noreferrer">
                      {credit.image && <img src={credit.image} alt="" />}
                      <span>
                        <strong>{credit.name}</strong>
                        <em>{credit.role || credit.occupations?.slice(0, 2).join(', ') || 'Staff'}</em>
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}

            {entry.characters?.length ? (
              <section className="info-section">
                <div className="info-section-title">
                  <Users size={17} />
                  <h3>Characters</h3>
                </div>
                <div className="credit-list">
                  {entry.characters.slice(0, 8).map((credit) => (
                    <a className="credit-row" href={credit.siteUrl || '#'} key={`${credit.id}-${credit.role}`} target="_blank" rel="noreferrer">
                      {credit.image && <img src={credit.image} alt="" />}
                      <span>
                        <strong>{credit.name}</strong>
                        <em>{[credit.role, credit.voiceActor ? `VA: ${credit.voiceActor.name}` : ''].filter(Boolean).join(' - ')}</em>
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="focus-secondary-grid">
            {entry.relations?.length ? (
              <section className="info-section">
                <div className="info-section-title">
                  <LibraryBig size={17} />
                  <h3>Related seasons</h3>
                </div>
                <div className="relation-list">
                  {entry.relations.slice(0, 8).map((relation) => (
                    <article className="relation-card" key={`${relation.anilistId}-${relation.relationType}`}>
                      {relation.coverImage && <img src={relation.coverImage} alt="" />}
                      <span>
                        <strong>{relation.title}</strong>
                        <em>{[relation.relationType, relation.format, relation.seasonYear].filter(Boolean).join(' - ')}</em>
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="info-section">
              <div className="info-section-title">
                <Link size={17} />
                <h3>Tags and links</h3>
              </div>
              {tagList.length ? (
                <div className="chip-list">
                  {tagList.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
              {entry.externalLinks?.length || entry.siteUrl ? (
                <div className="link-list">
                  {entry.siteUrl && (
                    <a href={entry.siteUrl} target="_blank" rel="noreferrer">
                      AniList
                    </a>
                  )}
                  {entry.externalLinks?.slice(0, 8).map((link) => (
                    <a href={link.url} key={`${link.site}-${link.url}`} target="_blank" rel="noreferrer">
                      {link.site}
                    </a>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          {entry.notes && (
            <section className="info-section">
              <div className="info-section-title">
                <Archive size={17} />
                <h3>Notes</h3>
              </div>
              <p className="focus-notes">{entry.notes}</p>
            </section>
          )}
        </div>
      </motion.article>
    </motion.div>
  )
}

function LibraryView({
  entries,
  allCount,
  selectedEntry,
  selectedGroup,
  libraryQuery,
  setLibraryQuery,
  statusFilter,
  setStatusFilter,
  sortMode,
  setSortMode,
  setSelectedId,
  changeProgress,
  undoProgress,
  lastProgressChange,
  changeStatus,
  markWatched,
  setRewatchStatus,
  clearRewatchStatus,
  changeRating,
  saveNotes,
  saveEpisodeMemo,
  toggleFavorite,
  toggleRewatchWorthy,
  changePriority,
  saveDroppedReason,
  refreshEntry,
  removeEntry,
  openFocusModal,
  refreshingId,
  detailLoadingId,
  detailError,
}: {
  entries: LibraryGroup[]
  allCount: number
  selectedEntry: AnimeEntry | null
  selectedGroup: LibraryGroup | null
  libraryQuery: string
  setLibraryQuery: (value: string) => void
  statusFilter: LibraryFilter
  setStatusFilter: (value: LibraryFilter) => void
  sortMode: SortMode
  setSortMode: (value: SortMode) => void
  setSelectedId: (id: string) => void
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
  undoProgress: (entry: AnimeEntry) => void
  lastProgressChange: ProgressUndoSnapshot | null
  changeStatus: (entry: AnimeEntry, status: WatchStatus) => void
  markWatched: (entry: AnimeEntry) => void
  setRewatchStatus: (entry: AnimeEntry, rewatchStatus: Exclude<RewatchStatus, 'none'>) => void
  clearRewatchStatus: (entry: AnimeEntry) => void
  changeRating: (entry: AnimeEntry, rating: number) => void
  saveNotes: (entry: AnimeEntry, notes: string) => void
  saveEpisodeMemo: (entry: AnimeEntry, memo: string) => void
  toggleFavorite: (entry: AnimeEntry) => void
  toggleRewatchWorthy: (entry: AnimeEntry) => void
  changePriority: (entry: AnimeEntry, priority: EntryPriority) => void
  saveDroppedReason: (entry: AnimeEntry, reason: string) => void
  refreshEntry: (entry: AnimeEntry) => Promise<void>
  removeEntry: (entry: AnimeEntry) => void
  openFocusModal: () => void
  refreshingId: string | null
  detailLoadingId: string | null
  detailError: string
}) {
  const [draftNotes, setDraftNotes] = useState(selectedEntry?.notes || '')

  useEffect(() => {
    setDraftNotes(selectedEntry?.notes || '')
  }, [selectedEntry?.id, selectedEntry?.notes])

  const detailLoading = selectedEntry ? detailLoadingId === selectedEntry.id : false
  const selectedEpisodes = selectedEntry ? episodeRowsFor(selectedEntry) : []
  const applyNoteTemplate = (template: string) => {
    setDraftNotes((current) => (current.trim() ? `${current.trimEnd()}\n${template}` : template))
  }

  return (
    <>
      <section className="library-tools">
        <div className="filter-input">
          <Search size={17} />
          <input
            aria-label="Filter library"
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="Filter library"
          />
        </div>

        <label className="select-control">
          <ListFilter size={16} />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LibraryFilter)}>
            <option value="all">All statuses</option>
            {statusOrder.map((status) => (
              <option key={status} value={status}>
                {statusMeta[status].label}
              </option>
            ))}
            <option value="rewatch">Rewatch queue</option>
            <option value="rewatching">Rewatching</option>
          </select>
          <ChevronDown size={15} />
        </label>

        <label className="select-control">
          <Archive size={16} />
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="recent">Recent</option>
            <option value="title">Title</option>
            <option value="rating">Rating</option>
            <option value="progress">Progress</option>
          </select>
          <ChevronDown size={15} />
        </label>
      </section>

      <section className="library-layout">
        <div className="cover-grid">
          {entries.map((group) => (
            <AnimeCard
              key={group.id}
              group={group}
              selected={selectedGroup?.id === group.id}
              setSelectedId={setSelectedId}
              changeProgress={changeProgress}
            />
          ))}
          {!entries.length && (
            <div className="empty-library">
	              <EmptyPanel
	                image={TOAD_SAGE_IMAGE}
	                title={allCount ? 'No matches' : 'Library is empty'}
	              />
            </div>
          )}
        </div>

        <aside className="detail-panel">
          {selectedEntry ? (
            <>
              <div
                className="detail-banner"
                style={{ backgroundImage: `url(${selectedEntry.bannerImage || selectedEntry.coverImage || artPanels[0]})` }}
              />
              <div className="detail-body">
                <div className="detail-title-row">
                  <div>
                    <span className={statusClass(selectedEntry.status)}>{statusMeta[selectedEntry.status].short}</span>
                    {isRewatchQueued(selectedEntry) && (
                      <span className={rewatchClass(selectedEntry.rewatchStatus)}>
                        <RefreshCcw size={13} />
                        {rewatchMeta[selectedEntry.rewatchStatus as Exclude<RewatchStatus, 'none'>].short}
                      </span>
                    )}
                    <h2>{selectedEntry.title}</h2>
                    <p>{[selectedEntry.format, selectedEntry.seasonYear, selectedEntry.source].filter(Boolean).join(' - ')}</p>
                  </div>
                  <div className="detail-title-actions">
                    <button
                      className="icon-button detail-expand-button"
                      type="button"
                      title="Open focused anime view"
                      aria-label="Open focused anime view"
                      onClick={openFocusModal}
                    >
                      <Maximize2 size={17} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Refresh metadata"
                      onClick={() => void refreshEntry(selectedEntry)}
                      disabled={refreshingId === selectedEntry.id}
                    >
                      {refreshingId === selectedEntry.id ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
                    </button>
                  </div>
                </div>

                {selectedGroup && selectedGroup.entries.length > 1 && (
                  <section className="season-switcher" aria-label={`${selectedGroup.title} seasons in library`}>
                    <div className="season-switcher-heading">
                      <LibraryBig size={16} />
                      <span>{selectedGroup.entries.length} seasons in library</span>
                    </div>
                    <div className="season-tab-list">
                      {selectedGroup.entries.map((entry, index) => {
                        const active = selectedEntry.id === entry.id
                        return (
                          <button
                            className={active ? 'season-tab season-tab-active' : 'season-tab'}
                            key={entry.id}
                            type="button"
                            onClick={() => setSelectedId(entry.id)}
                          >
                            <img src={entry.coverImage || artPanels[2]} alt="" />
                            <span>
                              <strong>{seasonLabelFor(entry, selectedGroup, index)}</strong>
                              <em>{entry.title}</em>
                            </span>
                            <b>
                              {entry.progress}
                              {entry.episodesTotal ? `/${entry.episodesTotal}` : ''}
                            </b>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )}

	                <div className="detail-controls">
	                  <label>
                    <span>Status</span>
                    <select
                      value={selectedEntry.status}
                      onChange={(event) => changeStatus(selectedEntry, event.target.value as WatchStatus)}
                    >
                      {statusOrder.map((status) => (
                        <option key={status} value={status}>
                          {statusMeta[status].label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Score</span>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={selectedEntry.rating || 0}
                      onChange={(event) => changeRating(selectedEntry, Number(event.target.value))}
                    />
	                    <strong>{selectedEntry.rating ? selectedEntry.rating.toFixed(1) : '-'}</strong>
	                  </label>
	                </div>

                <EntryProfileControls
                  entry={selectedEntry}
                  group={selectedGroup}
                  changeRating={changeRating}
                  toggleFavorite={toggleFavorite}
                  toggleRewatchWorthy={toggleRewatchWorthy}
                  changePriority={changePriority}
                  saveDroppedReason={saveDroppedReason}
                />

                <div className="episode-editor">
                  <button
                    className="icon-button"
                    type="button"
                    title="Previous episode"
                    onClick={() => changeProgress(selectedEntry, selectedEntry.progress - 1)}
                  >
                    <Minus size={17} />
                  </button>
                  <div>
                    <span>Episodes</span>
                    <strong>
                      {selectedEntry.progress}
                      {selectedEntry.episodesTotal ? ` / ${selectedEntry.episodesTotal}` : ''}
                    </strong>
                    <ProgressTrack entry={selectedEntry} progress={selectedEntry.progress} total={selectedEntry.episodesTotal} />
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    title="Next episode"
                    onClick={() => changeProgress(selectedEntry, selectedEntry.progress + 1)}
                  >
                    <Plus size={17} />
                  </button>
                </div>

                <EpisodeMemoryPanel entry={selectedEntry} saveEpisodeMemo={saveEpisodeMemo} />

                <EpisodeJumpControl entry={selectedEntry} changeProgress={changeProgress} />
                <BulkEpisodeTools
                  entry={selectedEntry}
                  changeProgress={changeProgress}
                  undoProgress={undoProgress}
                  canUndo={lastProgressChange?.entryId === selectedEntry.id}
                />

                <button
                  className="mark-watched-button"
                  type="button"
                  onClick={() => markWatched(selectedEntry)}
                  disabled={
                    selectedEntry.status === 'completed' &&
                    (!selectedEntry.episodesTotal || selectedEntry.progress >= selectedEntry.episodesTotal)
                  }
                >
                  <Check size={17} />
                  <span>
                    {selectedEntry.status === 'completed' ? 'Watched already' : 'Mark watched already'}
                  </span>
                </button>

                <div className="rewatch-actions">
                  <button
                    className="rewatch-action-button"
                    type="button"
                    onClick={() => setRewatchStatus(selectedEntry, 'planned')}
                    disabled={selectedEntry.rewatchStatus === 'planned'}
                  >
                    <RefreshCcw size={16} />
                    <span>{selectedEntry.rewatchStatus === 'planned' ? 'Rewatch planned' : 'Plan rewatch'}</span>
                  </button>
                  <button
                    className="rewatch-action-button strong"
                    type="button"
                    onClick={() => setRewatchStatus(selectedEntry, 'rewatching')}
                    disabled={selectedEntry.rewatchStatus === 'rewatching'}
                  >
                    <Play size={16} />
                    <span>{selectedEntry.rewatchStatus === 'rewatching' ? 'Rewatching now' : 'Start rewatch'}</span>
                  </button>
                  {isRewatchQueued(selectedEntry) && (
                    <button className="rewatch-action-button subtle" type="button" onClick={() => clearRewatchStatus(selectedEntry)}>
                      <Trash2 size={16} />
                      <span>Clear rewatch</span>
                    </button>
                  )}
                </div>

                {(detailLoading || detailError) && (
                  <div className={detailError ? 'detail-load detail-load-error' : 'detail-load'}>
                    {detailLoading ? <Loader2 className="spin" size={16} /> : <Info size={16} />}
                    <span>{detailError || 'Loading full anime details and episode data...'}</span>
                  </div>
                )}

                <section className="info-section">
                  <div className="info-section-title">
                    <Info size={17} />
                    <h3>Series details</h3>
                  </div>
                  <div className="fact-grid">
                    <Fact label="Episodes" value={selectedEntry.episodesTotal ? selectedEntry.episodesTotal.toString() : 'Unknown'} />
                    <Fact label="Duration" value={selectedEntry.duration ? `${selectedEntry.duration} min` : '-'} />
                    <Fact label="Season" value={formatSeason(selectedEntry)} />
                    <Fact label="Score" value={selectedEntry.averageScore ? `${selectedEntry.averageScore}%` : '-'} />
                    <Fact label="Mean" value={selectedEntry.meanScore ? `${selectedEntry.meanScore}%` : '-'} />
                    <Fact label="Popularity" value={formatNumber(selectedEntry.popularity)} />
                    <Fact label="Source" value={selectedEntry.source || '-'} />
                    <Fact label="Country" value={selectedEntry.countryOfOrigin || '-'} />
                  </div>
                  {selectedEntry.rankings?.length ? (
                    <div className="ranking-row">
                      {selectedEntry.rankings.slice(0, 3).map((ranking) => (
                        <span key={`${ranking.type}-${ranking.rank}-${ranking.context}`}>
                          #{ranking.rank} {ranking.context || ranking.type?.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="info-section">
                  <div className="info-section-title">
                    <Check size={17} />
                    <h3>Episodes</h3>
                  </div>
                  {selectedEpisodes.length ? (
                    <div className="episode-list">
                      {selectedEpisodes.map((episode) => {
                        const watched = episode.number <= selectedEntry.progress
                        return (
                          <button
                            className={watched ? 'episode-row episode-row-watched' : 'episode-row'}
                            key={episode.number}
                            type="button"
                            onClick={() => changeProgress(selectedEntry, episode.number)}
                          >
                            <span className="episode-number">{episode.number}</span>
                            <span className="episode-copy">
                              <strong>{episode.title}</strong>
                              <em>
                                {[formatEpisodeDate(episode.aired), episode.filler ? 'Filler' : '', episode.recap ? 'Recap' : '']
                                  .filter(Boolean)
                                  .join(' - ')}
                              </em>
                            </span>
                            <span className="episode-state">{watched ? 'Watched' : 'Mark'}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="detail-muted">
                      {selectedEntry.idMal
                        ? selectedEntry.episodeListError || 'Episode list is loading from Jikan.'
                        : 'Episode list unavailable for this title.'}
                    </p>
                  )}
                </section>

                {selectedEntry.nextAiringEpisode && (
                  <div className="airing-card">
                    <CalendarDays size={18} />
                    <div>
                      <span>Episode {selectedEntry.nextAiringEpisode.episode}</span>
                      <strong>{formatDate(selectedEntry.nextAiringEpisode.airingAt)}</strong>
                    </div>
                  </div>
                )}

                <div className="tag-row">
                  {selectedEntry.genres.slice(0, 6).map((genre) => (
                    <span key={genre}>{genre}</span>
                  ))}
                </div>

                {selectedEntry.studios.length ? (
                  <section className="info-section">
                    <div className="info-section-title">
                      <Archive size={17} />
                      <h3>Studios</h3>
                    </div>
                    <div className="chip-list">
                      {selectedEntry.studios.map((studio) => (
                        <span key={studio}>{studio}</span>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedEntry.staff?.length ? (
                  <section className="info-section">
                    <div className="info-section-title">
                      <Users size={17} />
                      <h3>Staff and production</h3>
                    </div>
                    <div className="credit-list">
                      {selectedEntry.staff.map((credit) => (
                        <a className="credit-row" href={credit.siteUrl || '#'} key={`${credit.id}-${credit.role}`} target="_blank" rel="noreferrer">
                          {credit.image && <img src={credit.image} alt="" />}
                          <span>
                            <strong>{credit.name}</strong>
                            <em>{credit.role || credit.occupations?.slice(0, 2).join(', ') || 'Staff'}</em>
                          </span>
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedEntry.characters?.length ? (
                  <section className="info-section">
                    <div className="info-section-title">
                      <Users size={17} />
                      <h3>Characters and voices</h3>
                    </div>
                    <div className="credit-list">
                      {selectedEntry.characters.map((credit) => (
                        <a className="credit-row" href={credit.siteUrl || '#'} key={`${credit.id}-${credit.role}`} target="_blank" rel="noreferrer">
                          {credit.image && <img src={credit.image} alt="" />}
                          <span>
                            <strong>{credit.name}</strong>
                            <em>
                              {[credit.role, credit.voiceActor ? `VA: ${credit.voiceActor.name}` : ''].filter(Boolean).join(' - ')}
                            </em>
                          </span>
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedEntry.relations?.length ? (
                  <section className="info-section">
                    <div className="info-section-title">
                      <LibraryBig size={17} />
                      <h3>Related seasons</h3>
                    </div>
                    <div className="relation-list">
                      {selectedEntry.relations.slice(0, 8).map((relation) => (
                        <article className="relation-card" key={`${relation.anilistId}-${relation.relationType}`}>
                          {relation.coverImage && <img src={relation.coverImage} alt="" />}
                          <span>
                            <strong>{relation.title}</strong>
                            <em>{[relation.relationType, relation.format, relation.seasonYear].filter(Boolean).join(' - ')}</em>
                          </span>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedEntry.tags?.length ? (
                  <section className="info-section">
                    <div className="info-section-title">
                      <Sparkles size={17} />
                      <h3>Tags</h3>
                    </div>
                    <div className="chip-list">
                      {selectedEntry.tags.slice(0, 14).map((tag) => (
                        <span key={tag.name}>{tag.name}</span>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedEntry.externalLinks?.length || selectedEntry.siteUrl ? (
                  <section className="info-section">
                    <div className="info-section-title">
                      <Link size={17} />
                      <h3>Links</h3>
                    </div>
                    <div className="link-list">
                      {selectedEntry.siteUrl && (
                        <a href={selectedEntry.siteUrl} target="_blank" rel="noreferrer">
                          AniList
                        </a>
                      )}
                      {selectedEntry.externalLinks?.slice(0, 8).map((link) => (
                        <a href={link.url} key={`${link.site}-${link.url}`} target="_blank" rel="noreferrer">
                          {link.site}
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedEntry.description && <p className="synopsis">{selectedEntry.description}</p>}

                <div className="notes-box">
                  <div className="notes-box-heading">
                    <span>Notes</span>
                    <Sparkles size={15} />
                  </div>
                  <div className="note-template-row" aria-label="Note templates">
                    {noteTemplates.map((template) => (
                      <button key={template.label} type="button" onClick={() => applyNoteTemplate(template.value)}>
                        {template.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    onBlur={() => saveNotes(selectedEntry, draftNotes)}
                    rows={5}
                  />
                </div>

                <div className="detail-footer">
                  <span>Added {formatShortDate(selectedEntry.addedAt)}</span>
                  <button className="danger-button" type="button" onClick={() => removeEntry(selectedEntry)}>
                    <Trash2 size={16} />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            </>
	          ) : (
	            <EmptyPanel image={TOAD_SAGE_IMAGE} title="No title selected" />
	          )}
        </aside>
      </section>
    </>
  )
}

function AnimeCard({
  group,
  selected,
  setSelectedId,
  changeProgress,
}: {
  group: LibraryGroup
  selected: boolean
  setSelectedId: (id: string) => void
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
}) {
  const StatusIcon = statusMeta[group.status].icon
  const activeSeasonIndex = Math.max(0, group.entries.findIndex((entry) => entry.id === group.active.id))
  const progressLabel = `Ep ${group.progress}${group.episodesTotal ? ` / ${group.episodesTotal}` : ''}`
  const completeRun = isCompleteRunGroup(group)
  const perfectFavorite = group.entries.some(hasPerfectFavorite)

  return (
    <article className={selected ? 'anime-card anime-card-selected' : 'anime-card'}>
      <button className="cover-button" type="button" onClick={() => setSelectedId(group.active.id)}>
        <img src={group.primary.coverImage || artPanels[2]} alt={`${group.title} cover`} />
        <span className={statusClass(group.status)}>
          <StatusIcon size={13} />
          {statusMeta[group.status].short}
        </span>
        {group.entries.length > 1 && (
          <span className="season-count-pill">
            <LibraryBig size={13} />
            {group.entries.length} seasons
          </span>
        )}
        {completeRun && (
          <span className="complete-run-stamp">
            <Check size={13} />
            Complete run
          </span>
        )}
        {isGroupRewatchQueued(group) && (
          <span className={rewatchClass(group.rewatchStatus)}>
            <RefreshCcw size={13} />
            {rewatchMeta[group.rewatchStatus as Exclude<RewatchStatus, 'none'>].short}
          </span>
        )}
        {group.entries.length > 1 && (
          <span className="season-cover-stack" aria-hidden="true">
            {group.entries.slice(0, 3).map((entry) => (
              <img src={entry.coverImage || artPanels[2]} alt="" key={entry.id} />
            ))}
          </span>
        )}
      </button>
      <div className="card-copy">
        <h3>{group.title}</h3>
        <p>{progressLabel}</p>
        {group.entries.length > 1 && (
          <p className="series-card-meta">Active: {seasonLabelFor(group.active, group, activeSeasonIndex)}</p>
        )}
        <ProgressTrack
          entry={group.active}
          progress={group.progress}
          total={group.episodesTotal}
        />
        <div className="card-actions">
          <button
            className="mini-icon-button"
            type="button"
            title="Previous episode"
            onClick={() => changeProgress(group.active, group.active.progress - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="mini-icon-button strong"
            type="button"
            title="Next episode"
            onClick={() => changeProgress(group.active, group.active.progress + 1)}
          >
            <ChevronRight size={15} />
          </button>
          <span className={perfectFavorite ? 'rating-glint perfect-favorite-glint' : 'rating-glint'}>
            <Star size={13} />
            {group.averageRating ? group.averageRating.toFixed(1) : '-'}
          </span>
        </div>
      </div>
    </article>
  )
}

function UpcomingView({
  entries,
  setSelectedId,
  setView,
  changeProgress,
}: {
  entries: AnimeEntry[]
  setSelectedId: (id: string) => void
  setView: (view: ViewName) => void
  changeProgress: (entry: AnimeEntry, nextProgress: number) => void
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Airing queue</p>
          <h2>Upcoming episodes</h2>
        </div>
        <CalendarDays size={20} />
      </div>

      {entries.length ? (
        <div className="upcoming-list">
          {entries.map((entry) => (
            <article className="upcoming-row" key={entry.id}>
              <img src={entry.coverImage || artPanels[2]} alt={`${entry.title} cover`} />
              <div>
                <span>{formatDate(entry.nextAiringEpisode?.airingAt)}</span>
                <h3>{entry.title}</h3>
                <p>Episode {entry.nextAiringEpisode?.episode}</p>
              </div>
              <div className="upcoming-actions">
                <button
                  className="icon-button"
                  type="button"
                  title="Open title"
                  onClick={() => {
                    setSelectedId(entry.id)
                    setView('library')
                  }}
                >
                  <LibraryBig size={17} />
                </button>
                <button
                  className="icon-button strong"
                  type="button"
                  title="Mark watched"
                  onClick={() => changeProgress(entry, entry.progress + 1)}
                >
                  <Plus size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
	      ) : (
	        <EmptyPanel image={TOAD_SAGE_IMAGE} title="No upcoming episodes" />
	      )}
    </section>
  )
}

function HistoryView({
  history,
  library,
  setSelectedId,
  setView,
}: {
  history: HistoryEvent[]
  library: AnimeEntry[]
  setSelectedId: (id: string) => void
  setView: (view: ViewName) => void
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Archive</p>
          <h2>Watch history</h2>
        </div>
        <History size={20} />
      </div>
      <Timeline
        events={history}
        onOpen={(event) => {
          if (!event.animeId) return
          const entry = library.find((item) => item.id === event.animeId)
          if (!entry) return
          setSelectedId(entry.id)
          setView('library')
        }}
      />
    </section>
  )
}

function Timeline({ events, onOpen }: { events: HistoryEvent[]; onOpen?: (event: HistoryEvent) => void }) {
	  if (!events.length) {
	    return <EmptyPanel image={TOAD_SAGE_IMAGE} title="No activity yet" compact />
	  }

  return (
    <div className="timeline">
      {events.map((event) => (
        <button
          className="timeline-row"
          key={event.id}
          type="button"
          onClick={() => onOpen?.(event)}
          disabled={!onOpen || !event.animeId}
        >
          <span className={`timeline-dot timeline-dot-${event.type}`} />
          <div>
            <strong>{event.animeTitle}</strong>
            <p>{event.message}</p>
          </div>
          <time>{formatDate(event.at)}</time>
        </button>
      ))}
    </div>
  )
}

function EmptyPanel({ image = TOAD_SAGE_IMAGE, title, compact = false }: { image?: string; title: string; compact?: boolean }) {
  return (
    <div className={compact ? 'empty-panel empty-panel-compact' : 'empty-panel'}>
      <div className="empty-visual">
        <img className="empty-visual-bg" src={image} alt="" />
        <img className="empty-visual-image" src={image} alt="" />
      </div>
      <strong>{title}</strong>
    </div>
  )
}

export default App
