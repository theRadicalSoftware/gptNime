import { CalendarPlus, ChevronRight, Loader2 } from 'lucide-react'
import type { RelationInfo } from './model'
import { storyFormat, type StoryStep } from './story'
import './StoryNext.css'

export type StoryProgress = { status: string; progress: number; episodesTotal?: number | null }
type Props = {
  step: StoryStep
  tracked: (anilistId: number) => StoryProgress | undefined
  onStart: (relation: RelationInfo, plan: boolean) => void
  starting: number | null
  buttonClass: string
  variant: 'cinema' | 'card'
}

function startLabel(relation: RelationInfo, progress?: StoryProgress) {
  if (progress && progress.progress > 0 && progress.status !== 'completed') return 'Continue'
  if (relation.format === 'MOVIE') return 'Watch the movie'
  if (relation.format === 'OVA' || relation.format === 'SPECIAL') return `Watch the ${storyFormat(relation.format)}`
  return 'Start watching'
}

// "What comes next" after a finale: the direct sequel, where the main story
// resumes when that sequel is a movie or OVA, and optional side stories.
export default function StoryNext({ step, tracked, onStart, starting, buttonClass, variant }: Props) {
  const { next, after, extras } = step
  const progress = tracked(next.anilistId)
  const upcoming = next.releaseStatus === 'NOT_YET_RELEASED'
  const facts = [storyFormat(next.format), next.seasonYear, next.episodesTotal && next.format !== 'MOVIE' ? `${next.episodesTotal} episodes` : ''].filter(Boolean).join(' · ')
  return (
    <div className={`story-next story-next-${variant}`}>
      {next.coverImage && <img src={next.coverImage} alt="" loading="lazy" />}
      <div className="story-next-copy">
        <span className="story-next-eyebrow">Next in the story</span>
        <strong>{next.title}</strong>
        <small>{facts}{upcoming ? ' · not out yet' : ''}{progress ? ` · ${progress.status === 'completed' ? 'watched' : 'in your library'}` : ''}</small>
        {after && <small className="story-next-bridge">Comes before {after.title}, where the series continues.</small>}
        {extras.length > 0 && <small className="story-next-extra">Optional: {extras.map((extra) => `${extra.title} (${storyFormat(extra.format)})`).join(', ')}</small>}
      </div>
      <button className={buttonClass} type="button" disabled={starting !== null} onClick={() => onStart(next, upcoming)}>
        {starting === next.anilistId ? <Loader2 className="spin" size={15} /> : upcoming ? <CalendarPlus size={15} /> : null}
        {upcoming ? (progress ? 'In your plans' : 'Plan it') : startLabel(next, progress)}
        {!upcoming && <ChevronRight size={15} />}
      </button>
    </div>
  )
}
