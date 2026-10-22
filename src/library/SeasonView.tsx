import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, LibraryBig, Loader2, Play, Plus, Sprout } from 'lucide-react'
import type { AnimeEntry, SearchResult, WatchStatus } from './model'
import { fetchSeason, rankSeason, seasonLabel, seasonOf, shiftSeason, tasteOf, type SeasonKey, type SeasonPick, type SeasonShow } from './season'
import './SeasonView.css'

type Props = {
  library: AnimeEntry[]
  signalFor: (entry: AnimeEntry) => number
  statusLabel: (status: WatchStatus) => string
  onAdd: (result: SearchResult, status: WatchStatus) => void
  onOpen: (entry: AnimeEntry) => void
  onWatch: (result: SearchResult) => void
}

function airingLabel(show: SearchResult) {
  const next = show.nextAiringEpisode
  if (next?.airingAt) {
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(next.airingAt * 1000))
    return `Ep ${next.episode} · ${day}`
  }
  if (show.releaseStatus === 'NOT_YET_RELEASED') return 'Not aired yet'
  if (show.releaseStatus === 'FINISHED') return 'Finished airing'
  return ''
}

function formatLabel(format?: string | null) {
  return format === 'TV_SHORT' ? 'TV short' : format === 'MOVIE' ? 'Movie' : format === 'ONA' ? 'Web' : format || 'Anime'
}

export default function SeasonView({ library, signalFor, statusLabel, onAdd, onOpen, onWatch }: Props) {
  const [key, setKey] = useState<SeasonKey>(() => seasonOf(new Date()))
  const [shows, setShows] = useState<{ id: string; list: SeasonShow[] } | null>(null)
  const [error, setError] = useState('')
  const [hideTracked, setHideTracked] = useState(false)
  const id = `${key.season}:${key.year}`
  const current = seasonOf(new Date())

  useEffect(() => {
    let live = true
    setError('')
    fetchSeason(key).then(
      (list) => { if (live) setShows({ id, list }) },
      (reason) => { if (live) setError(reason instanceof Error && /429/.test(reason.message) ? 'AniList is busy. Try again in a minute.' : 'This season could not be loaded from AniList.') },
    )
    return () => { live = false }
  }, [id, key])

  const tracked = useMemo(() => new Map(library.map((entry) => [entry.anilistId, entry])), [library])
  const taste = useMemo(() => tasteOf(library, signalFor), [library, signalFor])
  const picks = useMemo(() => shows?.id === id ? rankSeason(shows.list, library, taste) : [], [id, library, shows, taste])
  const continuing = picks.filter((pick) => pick.continues && !tracked.has(pick.anilistId))
  const lineup = picks.filter((pick) => !continuing.includes(pick) && (!hideTracked || !tracked.has(pick.anilistId)))
  const loading = shows?.id !== id && !error

  const card = (pick: SeasonPick) => {
    const entry = tracked.get(pick.anilistId)
    const airing = airingLabel(pick)
    return (
      <article className={`season-card${entry ? ' is-tracked' : ''}`} key={pick.anilistId}>
        <img className="season-cover" src={pick.coverImage || '/art/citadel.png'} alt="" loading="lazy" />
        <div className="season-copy">
          <div className="season-kicker">
            <span>{[formatLabel(pick.format), pick.episodesTotal ? `${pick.episodesTotal} eps` : '', pick.studios[0]].filter(Boolean).join(' · ')}</span>
            {pick.match !== null && <strong className="season-match" title="How well this fits the shows you rate, finish and rewatch">{pick.match}% match</strong>}
          </div>
          <h3 title={pick.title}>{pick.title}</h3>
          {pick.continues ? <p className="season-reason is-sequel">Continues {pick.continues.title}</p> : pick.reasons.length ? <p className="season-reason">{pick.reasons.join(' · ')}</p> : <p className="season-reason">{pick.genres.slice(0, 3).join(' · ')}</p>}
          <div className="season-foot">
            <span className="season-airing">{airing}</span>
            <div className="season-actions">
              {entry ? <>
                <span className="season-status"><Check size={13} />{statusLabel(entry.status)}</span>
                <button className="mini-button" type="button" onClick={() => onOpen(entry)}><LibraryBig size={14} /><span>Open</span></button>
              </> : <>
                <button className="mini-button" type="button" onClick={() => onAdd(pick, 'planning')}><Plus size={14} /><span>Plan</span></button>
                <button className="mini-button strong" type="button" onClick={() => onWatch(pick)}><Play size={14} /><span>Watch</span></button>
              </>}
            </div>
          </div>
        </div>
      </article>
    )
  }

  return (
    <section className="panel season-panel">
      <div className="section-heading season-heading">
        <div>
          <p className="eyebrow">Seasonal lineup</p>
          <h2>{seasonLabel(key)}</h2>
          <p className="season-sub">{taste ? 'The season’s most popular shows, ordered by how well they fit your library.' : 'The season’s most popular shows. Rate or finish a few titles and this becomes personal.'}</p>
        </div>
        <div className="season-switch">
          <button className="icon-button" type="button" title={`Previous season: ${seasonLabel(shiftSeason(key, -1))}`} aria-label="Previous season" onClick={() => setKey(shiftSeason(key, -1))}><ChevronLeft size={18} /></button>
          <button className="mini-button" type="button" disabled={key.season === current.season && key.year === current.year} onClick={() => setKey(current)}><Sprout size={14} /><span>This season</span></button>
          <button className="icon-button" type="button" title={`Next season: ${seasonLabel(shiftSeason(key, 1))}`} aria-label="Next season" onClick={() => setKey(shiftSeason(key, 1))}><ChevronRight size={18} /></button>
        </div>
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {loading && <p className="notice notice-live season-loading"><Loader2 className="spin" size={15} />Loading {seasonLabel(key)} from AniList…</p>}

      {continuing.length > 0 && <>
        <h3 className="season-section">New seasons of shows you watch</h3>
        <div className="season-grid">{continuing.map(card)}</div>
      </>}

      {!loading && !error && <>
        <div className="season-section-row">
          <h3 className="season-section">{taste ? 'Picked for you' : 'Most popular'}</h3>
          <label className="season-toggle"><input type="checkbox" checked={hideTracked} onChange={(event) => setHideTracked(event.target.checked)} />Hide shows in my library</label>
        </div>
        {lineup.length ? <div className="season-grid">{lineup.map(card)}</div> : <p className="notice notice-empty">Everything this season is already in your library.</p>}
      </>}
    </section>
  )
}
