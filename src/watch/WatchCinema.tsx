import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, FileVideo, Film, FolderOpen, Link2, Maximize2, Minimize2, MonitorUp, Play, RotateCcw, Search, Subtitles, X } from 'lucide-react'
import type { Language, WatchRequest, WatchTitle } from './watchState'
import { clockLabel, episodeLabel, firstEpisode, mediaUrl, readWatchState, sourceFingerprint, WCO_CATALOGUES, WCO_SEARCH, wcoPage, writeWatchState } from './watchState'
import './WatchCinema.css'

type Props = {
  entries: WatchTitle[]
  request: WatchRequest | null
  onComplete: (id: string, episode: number) => void
  onDetails: (id: string) => void
  onClose: () => void
}
type Layout = 'cinema' | 'dock' | 'window'
type PictureWindow = Window & { documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } }

function moveCinema(host: HTMLElement, destination: HTMLElement, blocked: () => void) {
  const video = host.querySelector('video')
  const snapshot = video ? { time: video.currentTime, playing: !video.paused && !video.ended, rate: video.playbackRate } : null
  if (video && snapshot) {
    // Adoption into another document can reload media even when the element is preserved.
    video.dataset.cinemaMoving = 'true'
    const restore = () => queueMicrotask(() => {
      if (!video.isConnected || video.readyState < 1) return
      video.currentTime = snapshot.time
      video.playbackRate = snapshot.rate
      delete video.dataset.cinemaMoving
      if (snapshot.playing) void video.play().catch(blocked)
      else video.pause()
    })
    video.addEventListener('loadedmetadata', restore, { once: true })
    destination.append(host)
    if (video.readyState >= 1) restore()
  } else destination.append(host)
}

export default function WatchCinema({ entries, request, onComplete, onDetails, onClose }: Props) {
  const [selection, setSelection] = useState(() => {
    const entry = entries.find((item) => item.id === request?.id) || entries[0]
    return { id: entry?.id || '', episode: request?.episode || (entry ? firstEpisode(entry) : 1) }
  })
  const [layout, setLayout] = useState<Layout>('cinema')
  const [query, setQuery] = useState('')
  const [windowError, setWindowError] = useState('')
  const [host] = useState(() => document.createElement('div'))
  const childRef = useRef<Window | null>(null)
  const restoreRef = useRef<(() => void) | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const entry = entries.find((item) => item.id === selection.id)
  const lastRequest = useRef(request?.serial)

  useEffect(() => {
    host.className = 'cinema-portal'
    document.body.append(host)
    const returnFocus = document.activeElement as HTMLElement | null
    const beforeUnload = () => childRef.current?.close()
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      restoreRef.current?.()
      childRef.current?.close()
      host.remove()
      window.removeEventListener('beforeunload', beforeUnload)
      window.setTimeout(() => {
        if (returnFocus?.isConnected) returnFocus.focus()
        else document.querySelector<HTMLElement>('.anime-tv-fab')?.focus()
      }, 0)
    }
  }, [host])

  useEffect(() => {
    if (request?.serial === lastRequest.current) return
    lastRequest.current = request?.serial
    const requested = entries.find((item) => item.id === request?.id)
    if (requested) setSelection({ id: requested.id, episode: request?.episode || firstEpisode(requested) })
    if (childRef.current) childRef.current.focus()
    else setLayout('cinema')
  }, [entries, request])

  useEffect(() => {
    const doc = host.ownerDocument
    const root = document.getElementById('root')
    const modal = layout === 'cinema'
    const wasInert = root?.inert || false
    if (modal) {
      if (root) root.inert = true
      document.body.classList.add('cinema-modal-open')
    }
    const focus = () => host.querySelector<HTMLElement>('[data-cinema-focus]')?.focus()
    const timer = window.setTimeout(focus, 0)
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !doc.fullscreenElement) {
        event.preventDefault()
        if (layout === 'cinema') setLayout('dock')
        else if (layout === 'dock' && host.contains(doc.activeElement)) closeRef.current()
      }
      if (event.key !== 'Tab' || !modal) return
      const controls = Array.from(host.querySelectorAll<HTMLElement>('button, input, select, a[href], video[controls], [tabindex="0"]')).filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (doc.activeElement === first || !host.contains(doc.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (doc.activeElement === last || !host.contains(doc.activeElement))) { event.preventDefault(); first?.focus() }
    }
    doc.addEventListener('keydown', keyboard)
    return () => {
      window.clearTimeout(timer)
      if (modal) { if (root) root.inert = wasInert; document.body.classList.remove('cinema-modal-open') }
      doc.removeEventListener('keydown', keyboard)
    }
  }, [host, layout])

  const popIn = () => {
    const child = childRef.current
    restoreRef.current?.()
    childRef.current = null
    child?.close()
  }

  const popOut = async () => {
    if (childRef.current && !childRef.current.closed) { childRef.current.focus(); return }
    setWindowError('')
    try {
      const api = (window as PictureWindow).documentPictureInPicture
      const child = api
        ? await api.requestWindow({ width: 1080, height: 760 })
        : window.open('about:blank', 'gptnime-cinema', 'popup,width=1080,height=760')
      if (!child) { setWindowError('Allow popups for gptNime, then try Pop out again.'); return }
      if (!host.isConnected) { child.close(); return }
      child.document.title = 'GPTNime · Cinema'
      const base = child.document.createElement('base')
      base.href = document.baseURI
      child.document.head.append(base)
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => child.document.head.append(node.cloneNode(true)))
      child.document.documentElement.lang = 'en'
      child.document.body.className = 'cinema-window-body'
      moveCinema(host, child.document.body, () => setWindowError('Press play to continue in this window.'))
      childRef.current = child
      setLayout('window')
      let returned = false
      const restore = () => {
        if (returned) return
        returned = true
        moveCinema(host, document.body, () => setWindowError('Press play to continue.'))
        setLayout('cinema')
        child.removeEventListener('pagehide', restore)
        restoreRef.current = null
      }
      restoreRef.current = restore
      child.addEventListener('pagehide', restore)
      // Some browsers don't dispatch pagehide when a regular popup is closed.
      const interval = window.setInterval(() => {
        if (child.closed) { restore(); childRef.current = null; window.clearInterval(interval) }
      }, 500)
      const originalRestore = restoreRef.current
      restoreRef.current = () => { originalRestore?.(); window.clearInterval(interval) }
    } catch {
      setWindowError('This browser could not open a player window. You can keep watching here or use the mini-player.')
    }
  }

  const tune = (item: WatchTitle) => setSelection({ id: item.id, episode: firstEpisode(item) })
  const visibleEntries = entries.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))

  return createPortal(
    <div className={`cinema-overlay cinema-layout-${layout}`} onMouseDown={(event) => {
      if (layout === 'cinema' && event.target === event.currentTarget) setLayout('dock')
    }}>
      <section id="anime-channel-panel" className="watch-cinema" role="dialog" aria-modal={layout === 'cinema' ? true : undefined} aria-label="GPTNime cinema">
        <header className="cinema-heading">
          <span className="cinema-emblem"><Clapperboard size={22} /></span>
          <div className="cinema-heading-copy"><span className="eyebrow">GPTNime cinema</span><h2>{entry?.title || 'A good night for anime'}</h2></div>
          <div className="cinema-window-actions">
            {layout === 'window' ? <button className="cinema-icon" aria-label="Pop player back in" title="Pop in" onClick={popIn}><MonitorUp size={18} /></button> : <>
              <button className="cinema-icon" aria-label={layout === 'dock' ? 'Expand cinema' : 'Dock mini-player'} title={layout === 'dock' ? 'Expand cinema' : 'Keep watching while browsing'} onClick={() => setLayout(layout === 'dock' ? 'cinema' : 'dock')}>{layout === 'dock' ? <Maximize2 size={18} /> : <Minimize2 size={18} />}</button>
              <button className="cinema-icon" aria-label="Pop out player" title="Pop out player" onClick={() => void popOut()}><MonitorUp size={18} /></button>
            </>}
            <button data-cinema-focus className="cinema-icon" aria-label="Close cinema" title="Close cinema" onClick={onClose}><X size={19} /></button>
          </div>
        </header>
        {windowError && <p className="cinema-message cinema-error" role="alert">{windowError}</p>}
        <div className="cinema-workspace">
          <div className="cinema-main">
            {entry ? <EpisodePlayer key={`${entry.id}:${selection.episode}`} entry={entry} episode={selection.episode} onComplete={onComplete} onEpisode={(episode) => setSelection({ id: entry.id, episode })} onRevealSource={() => { if (layout === 'dock') setLayout('cinema') }} onDetails={() => { if (layout !== 'window') setLayout('dock'); onDetails(entry.id) }} /> : <div className="cinema-empty"><Film size={38} /><h3>{entries.length ? 'Choose your next watch' : 'Your cinema starts here'}</h3><p>{entries.length ? 'Pick a title from your library to open its watch desk.' : 'Add a show or movie to your library, then press Watch.'}</p>{!entries.length && <button className="cinema-button primary" onClick={onClose}>Back to gptNime</button>}</div>}
          </div>
          <aside className="cinema-library">
            <div className="cinema-library-heading"><div><span className="eyebrow">Your collection</span><h3>Tonight’s lineup</h3></div><span className="cinema-count">{entries.length}</span></div>
            <label className="cinema-filter"><Search size={16} /><input aria-label="Find a title in cinema" placeholder="Find a show or movie" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="cinema-queue">
              {visibleEntries.map((item) => <button className={`cinema-queue-row${item.id === entry?.id ? ' is-active' : ''}`} key={item.id} onClick={() => tune(item)} aria-pressed={item.id === entry?.id}>
                <img src={item.coverImage || '/art/cinema-rooftop.png'} alt="" loading="lazy" /><span><strong>{item.title}</strong><small>{item.format === 'MOVIE' ? 'Movie' : `${item.progress} watched${item.episodesTotal ? ` / ${item.episodesTotal}` : ''}`}</small><em>{item.id === entry?.id ? 'In the cinema' : item.status === 'completed' ? 'Watch again' : episodeLabel(item, firstEpisode(item))}</em></span><Play size={14} />
              </button>)}
              {!visibleEntries.length && <p className="cinema-hint">{query ? 'No titles match that search.' : 'Your library will appear here.'}</p>}
            </div>
          </aside>
        </div>
      </section>
    </div>, host,
  )
}

type Source = { url: string; name: string; key: string; local: boolean }

function EpisodePlayer({ entry, episode, onComplete, onEpisode, onDetails, onRevealSource }: {
  entry: WatchTitle; episode: number; onComplete: Props['onComplete']; onEpisode: (episode: number) => void; onDetails: () => void; onRevealSource: () => void
}) {
  const [settings, setSettings] = useState(readWatchState)
  const [tab, setTab] = useState<'wco' | 'file' | 'url'>(settings.sourceTab)
  const [source, setSource] = useState<Source | null>(null)
  const [subtitle, setSubtitle] = useState<{ url: string; name: string } | null>(null)
  const [urlDraft, setUrlDraft] = useState('')
  const [pageDraft, setPageDraft] = useState('')
  const [pageScope, setPageScope] = useState('episode')
  const [searchTitle, setSearchTitle] = useState(entry.titleEnglish || entry.title)
  const [searchScope, setSearchScope] = useState('episodes')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [loading, setLoading] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [ended, setEnded] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const subtitleRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef(source)
  const subtitleUrlRef = useRef<string | null>(null)
  const savedAtRef = useRef(0)
  const markedRef = useRef(false)
  const playedRanges = useRef<[number, number][]>([])
  const progressRef = useRef(entry.progress)
  progressRef.current = entry.progress
  const movie = entry.format === 'MOVIE'
  const watched = episode <= entry.progress
  const nextAvailable = !movie && (!entry.episodesTotal || episode < entry.episodesTotal)
  const metadataTitle = entry.episodeList?.find((item) => item.number === episode)?.title
  const pageKey = `${entry.anilistId}:${episode}:${settings.language}`
  const titleKey = `${entry.anilistId}:title:${settings.language}`
  const savedPage = settings.pages[pageKey] || settings.pages[titleKey]
  const bookmarkPrefix = `${entry.anilistId}:${episode}:`

  const saveBookmark = useCallback(() => {
    const video = videoRef.current
    const media = sourceRef.current
    if (!video || video.dataset.cinemaMoving || !media || video.getAttribute('src') !== media.url || !Number.isFinite(video.duration) || video.duration <= 0) return
    const state = readWatchState()
    state.bookmarks[bookmarkPrefix + media.key] = { time: video.ended ? 0 : video.currentTime, duration: video.duration, updatedAt: Date.now() }
    writeWatchState(state)
  }, [bookmarkPrefix])

  const bindVideo = useCallback((node: HTMLVideoElement | null) => {
    if (!node) saveBookmark()
    videoRef.current = node
  }, [saveBookmark])

  useEffect(() => {
    const onPageHide = () => saveBookmark()
    window.addEventListener('pagehide', onPageHide)
    // Capture the element in the ref callback too: React clears refs before effect cleanup.
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      if (sourceRef.current?.local) URL.revokeObjectURL(sourceRef.current.url)
      if (subtitleUrlRef.current) URL.revokeObjectURL(subtitleUrlRef.current)
    }
  }, [saveBookmark])

  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setMediaError('This source is taking longer than expected. Check the video URL or choose another source.'), 15000)
    return () => window.clearTimeout(timer)
  }, [loading])

  const updateSettings = (patch: Partial<ReturnType<typeof readWatchState>>) => {
    const next = { ...readWatchState(), ...patch }
    setSettings(next)
    if (!writeWatchState(next)) setError('Browser storage is unavailable. Your choices will last for this session only.')
  }

  const chooseTab = (next: typeof tab) => {
    setTab(next); setError(''); updateSettings({ sourceTab: next })
  }

  const clearSource = () => {
    saveBookmark()
    videoRef.current?.pause()
    if (sourceRef.current?.local) URL.revokeObjectURL(sourceRef.current.url)
    if (subtitleUrlRef.current) URL.revokeObjectURL(subtitleUrlRef.current)
    sourceRef.current = null
    subtitleUrlRef.current = null
    setSource(null); setSubtitle(null); setMediaError(''); setLoading(false); setEnded(false); setCurrentTime(0); setDuration(0)
    if (fileRef.current) fileRef.current.value = ''
    if (subtitleRef.current) subtitleRef.current.value = ''
  }

  const chooseSource = (next: Source) => {
    clearSource()
    sourceRef.current = next
    markedRef.current = false
    playedRanges.current = []
    setSource(next); setLoading(true); setError(''); setNotice('')
  }

  const openProvider = (url?: string) => {
    setError(''); setNotice('')
    if (!url && !searchTitle.trim()) { setError('Enter the show or movie title first.'); return }
    // A provider-owned top-level window respects its framing and login requirements.
    // Establish the form in about:blank, then sever opener before navigation.
    const child = window.open('about:blank', '_blank', 'popup,width=1180,height=820')
    if (!child) { setError('Allow popups for gptNime to open WCO.'); return }
    videoRef.current?.pause()
    child.opener = null
    if (url) child.location.replace(url)
    else {
      const form = child.document.createElement('form')
      form.method = 'POST'; form.action = WCO_SEARCH
      const query = searchScope === 'episodes' && !movie ? `${searchTitle.trim()} episode ${episode} english ${settings.language === 'sub' ? 'subbed' : 'dubbed'}` : searchTitle.trim()
      for (const [name, value] of Object.entries({ catara: query, konuara: searchScope })) {
        const input = child.document.createElement('input')
        input.type = 'hidden'; input.name = name; input.value = value; form.append(input)
      }
      child.document.body.append(form); form.submit()
    }
    setNotice('WCO opened in its own window. Return here to mark watched or choose the next episode.')
  }

  const handleTime = () => {
    const video = videoRef.current
    if (!video || video.dataset.cinemaMoving) return
    setCurrentTime(video.currentTime)
    if (Date.now() - savedAtRef.current > 3000) { saveBookmark(); savedAtRef.current = Date.now() }
    // Union ranges across window transfers and replay; neither seeking nor watching
    // the same minute twice should inflate completion coverage.
    const ranges = [...playedRanges.current]
    for (let index = 0; index < video.played.length; index++) ranges.push([video.played.start(index), video.played.end(index)])
    ranges.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const range of ranges) {
      const previous = merged[merged.length - 1]
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1])
      else merged.push([...range])
    }
    playedRanges.current = merged
    if (!settings.autoMark || markedRef.current || episode !== progressRef.current + 1 || video.seeking || !Number.isFinite(video.duration) || video.duration <= 0) return
    const playedSeconds = merged.reduce((total, range) => total + range[1] - range[0], 0)
    if (playedSeconds / video.duration >= 0.9) { markedRef.current = true; onComplete(entry.id, episode) }
  }

  const officialLinks = (entry.externalLinks || []).filter((link, index, links) =>
    /^https?:\/\//.test(link.url) && links.findIndex((item) => item.url === link.url) === index &&
    (link.type?.toLowerCase().includes('streaming') || /crunchyroll|netflix|hulu|hidive|disney|prime video|amazon|youtube|bilibili|tubi|hbo|max|pluto|adult swim|vrv/i.test(link.site)),
  ).slice(0, 4)

  return <>
    <div className={`cinema-screen${source ? ' has-video' : ''}`}>
      {source ? <>
        <video key={source.url} ref={bindVideo} src={source.url} controls playsInline preload="metadata" aria-label={`${entry.title} ${episodeLabel(entry, episode)} player`}
          onLoadedMetadata={() => {
            const video = videoRef.current
            if (!video) return
            setDuration(video.duration); setLoading(false); setMediaError(''); video.playbackRate = speed
            const bookmark = readWatchState().bookmarks[bookmarkPrefix + source.key]
            if (!video.dataset.cinemaMoving && bookmark && bookmark.time > 3 && bookmark.time < video.duration - 5 && Math.abs(bookmark.duration - video.duration) < 2) { video.currentTime = bookmark.time; setNotice(`Resumed at ${clockLabel(bookmark.time)}. Press play when you’re ready.`) }
          }} onCanPlay={() => { setLoading(false); setMediaError('') }} onWaiting={() => setLoading(true)} onPlaying={() => { setLoading(false); setEnded(false) }} onTimeUpdate={handleTime} onPause={saveBookmark} onEnded={() => { handleTime(); saveBookmark(); setEnded(true) }} onError={() => { setLoading(false); setMediaError('This video could not be played. Check that the link points to a supported video file, or try an MP4 / WebM file.') }}>
          {subtitle && <track key={subtitle.url} src={subtitle.url} kind="subtitles" srcLang="en" label={subtitle.name} default onError={() => setError('These subtitles could not be loaded. Choose a valid WebVTT (.vtt) file.')} />}
        </video>
        {loading && !mediaError && <span className="cinema-loading" role="status">Loading video…</span>}
        {mediaError && <div className="cinema-media-error" role="alert"><Film size={26} /><p>{mediaError}</p><button className="cinema-button" onClick={clearSource}>Choose another source</button></div>}
      </> : <div className="cinema-screen-intro">
        <span className="cinema-night-tag"><span /> YOUR AFTER-HOURS ESCAPE</span>
        <span className="cinema-screen-episode">{episodeLabel(entry, episode)}{!movie && entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''}</span>
        <h3>{entry.title}</h3>
        <p>{metadataTitle && !/^Episode \d+$/i.test(metadataTitle) ? metadataTitle : movie ? 'Settle in. Make it a movie night.' : 'Your next episode, your own little cinema.'}</p>
        <button className="cinema-button primary cinema-start" onClick={() => tab === 'wco' ? openProvider(savedPage) : tab === 'file' ? fileRef.current?.click() : hostUrlInput()}><Play size={18} fill="currentColor" />{tab === 'wco' ? savedPage ? 'Open saved WCO page' : 'Find on WCO' : tab === 'file' ? 'Choose episode file' : 'Add a video URL'}</button>
        <span className="cinema-screen-footnote">{tab === 'wco' ? 'WCO plays in a separate provider window' : 'Plays here, in your cinema'}</span>
      </div>}
    </div>
    <div className="cinema-now-playing"><span><b>{episodeLabel(entry, episode)}</b>{watched && <em><Check size={13} /> Watched</em>}{source && <small title={source.name}>{source.name}</small>}</span><span className="cinema-time">{source ? `${clockLabel(currentTime)} / ${clockLabel(duration)}` : movie ? 'MOVIE NIGHT' : 'READY WHEN YOU ARE'}</span></div>
    <div className="cinema-controls">
      <div className="cinema-episode-navigation">
        <button className="cinema-icon" aria-label="Previous episode in cinema" disabled={episode <= 1 || movie} onClick={() => onEpisode(episode - 1)}><ChevronLeft size={18} /></button>
        {movie ? <span className="cinema-feature"><Film size={16} /> Feature film</span> : <label>Episode <input aria-label="Cinema episode number" type="number" min="1" max={entry.episodesTotal || undefined} key={episode} defaultValue={episode} onBlur={(event) => { const value = Number(event.currentTarget.value); if (Number.isInteger(value) && value >= 1 && (!entry.episodesTotal || value <= entry.episodesTotal)) onEpisode(value); else event.currentTarget.value = String(episode) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /><span>{entry.episodesTotal ? `of ${entry.episodesTotal}` : ''}</span></label>}
        <button className="cinema-icon" aria-label="Next episode in cinema" disabled={!nextAvailable} onClick={() => onEpisode(episode + 1)}><ChevronRight size={18} /></button>
      </div>
      <button className="cinema-button cinema-mark" disabled={watched} onClick={() => { markedRef.current = true; onComplete(entry.id, episode) }}><Check size={16} />{watched ? 'Watched' : episode > entry.progress + 1 ? `Mark through ep ${episode}` : movie ? 'Mark movie watched' : 'Mark watched'}</button>
      <button className="cinema-icon cinema-details-link" aria-label="Open title details" title="Title details" onClick={onDetails}><ExternalLink size={16} /></button>
    </div>
    {ended && <div className="cinema-finished" role="status"><span><Check size={17} />{nextAvailable ? 'Ready for the next episode?' : 'That’s a wrap. Thanks for watching.'}</span>{nextAvailable && <button className="cinema-button primary" onClick={() => onEpisode(episode + 1)}>Episode {episode + 1}<ChevronRight size={16} /></button>}</div>}
    <div className="cinema-source-desk">
      <div className="cinema-source-heading"><span className="eyebrow">Watch your way</span><span>Choose a source</span></div>
      <div className="cinema-source-tabs" role="group" aria-label="Video source">
        <button className={tab === 'wco' ? 'is-active' : ''} aria-pressed={tab === 'wco'} onClick={() => chooseTab('wco')}><ExternalLink size={17} /><span>WCO<small>Provider window</small></span></button>
        <button className={tab === 'file' ? 'is-active' : ''} aria-pressed={tab === 'file'} onClick={() => chooseTab('file')}><FolderOpen size={18} /><span>Your files<small>Play in cinema</small></span></button>
        <button className={tab === 'url' ? 'is-active' : ''} aria-pressed={tab === 'url'} onClick={() => chooseTab('url')}><Link2 size={18} /><span>Video URL<small>Play in cinema</small></span></button>
      </div>
      {tab === 'wco' && <div className="cinema-provider-panel">
        <div className="cinema-provider-description"><p>Find the show on WCO, then save its page for next time.</p><div className="cinema-language" role="group" aria-label="WCO language">{(['sub', 'dub'] as Language[]).map((language) => <button key={language} aria-pressed={settings.language === language} className={settings.language === language ? 'is-active' : ''} onClick={() => updateSettings({ language })}>{language === 'sub' ? 'Subbed' : 'Dubbed'}</button>)}</div></div>
        <form className="cinema-search-form" onSubmit={(event) => { event.preventDefault(); openProvider() }}>
          <input aria-label="WCO search title" value={searchTitle} onChange={(event) => setSearchTitle(event.target.value)} required maxLength={200} />
          <select aria-label="WCO search scope" value={searchScope} onChange={(event) => setSearchScope(event.target.value)}><option value="episodes">{movie ? 'Movie / episodes' : `Episode ${episode}`}</option><option value="series">Whole series</option></select>
          <button className="cinema-button" disabled={!searchTitle.trim()}><Search size={15} />Find on WCO</button>
        </form>
        {savedPage && <div className="cinema-saved-page"><button className="cinema-button primary" onClick={() => openProvider(savedPage)}><ExternalLink size={15} />Open saved {settings.pages[pageKey] ? 'episode' : 'title'}</button><button className="cinema-text-button" onClick={() => { const pages = { ...settings.pages }; delete pages[settings.pages[pageKey] ? pageKey : titleKey]; updateSettings({ pages }) }}>Forget link</button></div>}
        <details className="cinema-save-details"><summary>{savedPage ? 'Change saved WCO page' : 'Save a WCO page'}</summary><form className="cinema-page-form" onSubmit={(event) => {
          event.preventDefault(); const valid = wcoPage(pageDraft)
          if (!valid) { setError('Use a WCO show or episode page beginning with https://, rather than an embedded player or video link.'); return }
          updateSettings({ pages: { ...settings.pages, [pageScope === 'title' ? titleKey : pageKey]: valid } }); setPageDraft(''); setError(''); setNotice('WCO page saved for this title and language.')
        }}><label>WCO page URL<input aria-label="WCO page URL" type="url" placeholder="https://www.wco.tv/…" value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} required /></label><label>Save for<select aria-label="Save WCO page for" value={pageScope} onChange={(event) => setPageScope(event.target.value)}><option value="episode">{episodeLabel(entry, episode)}</option><option value="title">This whole title</option></select></label><button className="cinema-button">Save page</button></form></details>
        <p className="cinema-hint">WCO requires its own window. Availability, sign-in and playback are managed there; mark progress here when you finish.</p>
        <div className="cinema-provider-links"><button onClick={() => openProvider(WCO_CATALOGUES[settings.language])}>Browse {settings.language === 'sub' ? 'subbed' : 'dubbed'} anime <ExternalLink size={12} /></button><button onClick={() => openProvider(WCO_CATALOGUES.movies)}>Movies <ExternalLink size={12} /></button></div>
      </div>}
      {tab === 'file' && <div className="cinema-file-panel"><FileVideo size={29} /><div><strong>Bring your episode. We’ll set the scene.</strong><p>MP4, WebM and other formats your browser supports. Files stay on your device.</p></div><button className="cinema-button primary" onClick={() => fileRef.current?.click()}><FolderOpen size={16} />Choose file</button></div>}
      {tab === 'url' && <form className="cinema-url-panel" onSubmit={(event) => { event.preventDefault(); const valid = mediaUrl(urlDraft); if (!valid) { setError('Enter a direct HTTPS video URL (or a localhost video URL). Use the WCO tab for WCO pages.'); return } chooseSource({ url: valid, name: new URL(valid).pathname.split('/').pop() || 'Video stream', local: false, key: sourceFingerprint(valid) }); setUrlDraft('') }}><label>Direct video URL<input data-cinema-url aria-label="Direct video URL" type="url" value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} placeholder="https://…/episode.mp4" required /></label><button className="cinema-button primary"><Play size={16} />Load video</button><p className="cinema-hint">Use a direct MP4 / WebM link from your media host. Website pages won’t play here. Video links last for this session.</p></form>}
      <input ref={fileRef} className="cinema-file-input" type="file" accept="video/*,.mp4,.webm,.m4v,.mov,.mkv" aria-label="Choose local video" onChange={(event) => { const file = event.target.files?.[0]; if (file) chooseSource({ url: URL.createObjectURL(file), name: file.name, key: sourceFingerprint(`${file.name}:${file.size}:${file.lastModified}`), local: true }) }} />
      <input ref={subtitleRef} className="cinema-file-input" type="file" accept=".vtt,text/vtt" aria-label="Choose subtitle file" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (!file.name.toLowerCase().endsWith('.vtt')) { setError('Choose a WebVTT (.vtt) subtitle file.'); return } if (subtitleUrlRef.current) URL.revokeObjectURL(subtitleUrlRef.current); const url = URL.createObjectURL(file); subtitleUrlRef.current = url; setSubtitle({ url, name: file.name }) }} />
      {source && <div className="cinema-playback-tools">
        <button className="cinema-button" onClick={() => subtitleRef.current?.click()} title={subtitle?.name}><Subtitles size={16} />{subtitle ? 'Replace subtitles' : 'Subtitles'}</button>
        <label>Speed<select aria-label="Playback speed" value={speed} onChange={(event) => { const value = Number(event.target.value); setSpeed(value); if (videoRef.current) videoRef.current.playbackRate = value }}>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
        <button className="cinema-icon" aria-label="Restart current video" title="Restart" onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; setEnded(false); saveBookmark() }}><RotateCcw size={16} /></button>
        <button className="cinema-text-button" onClick={clearSource}>Clear source</button>
        <label className="cinema-auto-mark"><input type="checkbox" checked={settings.autoMark} onChange={(event) => updateSettings({ autoMark: event.target.checked })} />Mark next unwatched episode after 90% playback</label>
      </div>}
      {error && <p className="cinema-message cinema-error" role="alert">{error}</p>}
      {notice && <p className="cinema-message" role="status">{notice}</p>}
      {officialLinks.length > 0 && <div className="cinema-official"><span>Also available on</span>{officialLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.site}<ExternalLink size={12} /></a>)}</div>}
    </div>
  </>

  function hostUrlInput() {
    // Works in either the main document or the separate cinema window.
    onRevealSource()
    window.setTimeout(() => fileRef.current?.ownerDocument.querySelector<HTMLInputElement>('[data-cinema-url]')?.focus(), 0)
  }
}
