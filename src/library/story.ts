import type { RelationInfo } from './model'

// What to watch after a title ends, from AniList's relations. AniList chains
// sequels through the movies and OVAs between seasons, so a sequel that is a
// movie is followed one step further to show where the main story resumes.
export type StoryStep = { next: RelationInfo; after?: RelationInfo; extras: RelationInfo[] }
type StoryTitle = { anilistId: number; relations?: RelationInfo[] }
type Loader = (anilistId: number) => Promise<{ relations?: RelationInfo[] }>

const animeFormats = new Set(['TV', 'TV_SHORT', 'ONA', 'MOVIE', 'SPECIAL', 'OVA'])
const seriesFormats = new Set(['TV', 'TV_SHORT', 'ONA'])
const formatOrder = ['TV', 'ONA', 'TV_SHORT', 'MOVIE', 'OVA', 'SPECIAL']
const cache = new Map<number, Promise<StoryStep | null>>()

export function storyFormat(format?: string | null) {
  return format === 'MOVIE' ? 'Movie' : format === 'OVA' ? 'OVA' : format === 'SPECIAL' ? 'Special' : format === 'ONA' ? 'Web series' : 'Series'
}

export function sequelOf(relations?: RelationInfo[]) {
  return (relations || [])
    .filter((relation) => relation.relationType === 'SEQUEL' && animeFormats.has(relation.format || '') && relation.releaseStatus !== 'CANCELLED')
    .sort((first, second) => (first.seasonYear || 9999) - (second.seasonYear || 9999) || formatOrder.indexOf(first.format || '') - formatOrder.indexOf(second.format || ''))[0]
}

async function findStep(title: StoryTitle, load: Loader): Promise<StoryStep | null> {
  const relations = title.relations || (await load(title.anilistId)).relations
  const next = sequelOf(relations)
  if (!next) return null
  const extras = (relations || [])
    .filter((relation) => relation.relationType === 'SIDE_STORY' && ['OVA', 'SPECIAL', 'MOVIE'].includes(relation.format || '') && relation.anilistId !== next.anilistId)
    .slice(0, 2)
  if (seriesFormats.has(next.format || '')) return { next, extras }
  const after = sequelOf((await load(next.anilistId).catch(() => ({ relations: [] }))).relations)
  return { next, after: after && seriesFormats.has(after.format || '') ? after : undefined, extras }
}

export function storyAfter(title: StoryTitle, load: Loader): Promise<StoryStep | null> {
  const known = cache.get(title.anilistId)
  if (known) return known
  const step = findStep(title, load)
  cache.set(title.anilistId, step)
  step.catch(() => cache.delete(title.anilistId))
  return step
}
