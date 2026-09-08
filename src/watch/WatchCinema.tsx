import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, FileVideo, Film, FolderOpen, Link2, Maximize2, Minimize2, MonitorUp, Play, RotateCcw, Search, Subtitles, X } from 'lucide-react'
import type { Language, WatchRequest, WatchTitle } from './watchState'
import { clockLabel, episodeLabel, firstEpisode, localPlaybackBrowser, mediaUrl, readWatchState, sourceFingerprint, WCO_CATALOGUES, WCO_SEARCH, wcoPage, writeWatchState } from './watchState'
import './WatchCinema.css'

type Props = {
  entries: WatchTitle[]
  request: WatchRequest | null
  onComplete: (id: string, episode: number) => void
  onDetails: (id: string) => void
  onClose: () => void
}
type Preparation = { url?: string; language?: Language; search?: boolean; choose?: boolean }
type Match = { url: string; title: string; language?: Language }
type Selection = { id: string; episode: number; intent: number; preparation?: Preparation }
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
      if (snapshot.playing) void video.play().catch((error) => { if (error?.name !== 'AbortError') blocked() })
      else video.pause()
    })
    video.addEventListener('loadedmetadata', restore, { once: true })
    destination.append(host)
    if (video.readyState >= 1) restore()
  } else destination.append(host)
}

export default function WatchCinema({ entries, request, onComplete, onDetails, onClose }: Props) {
  const [selection, setSelection] = useState<Selection>(() => {
    const entry = entries.find((item) => item.id === request?.id) || entries[0]
    return { id: entry?.id || '', episode: request?.episode || (entry ? firstEpisode(entry) : 1), intent: request ? 1 : 0 }
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
    const playing = () => setWindowError('')
    window.addEventListener('beforeunload', beforeUnload)
    host.addEventListener('playing', playing, true)
    return () => {
      restoreRef.current?.()
      childRef.current?.close()
      host.remove()
      window.removeEventListener('beforeunload', beforeUnload)
      host.removeEventListener('playing', playing, true)
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
    if (requested) setSelection((previous) => ({ id: requested.id, episode: request?.episode || firstEpisode(requested), intent: previous.intent + 1 }))
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
      // Video has no per-element referrerPolicy. Preserve the cinema document's
      // privacy policy before moving media into either kind of player window.
      const referrer = child.document.createElement('meta')
      referrer.name = 'referrer'
      referrer.content = 'no-referrer'
      child.document.head.append(referrer)
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

  const tune = (item: WatchTitle) => setSelection((previous) => ({ id: item.id, episode: firstEpisode(item), intent: previous.intent + 1 }))
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
            {entry ? <EpisodePlayer key={`${entry.id}:${selection.episode}`} entry={entry} episode={selection.episode} intent={selection.intent} preparation={selection.preparation} onComplete={onComplete} onEpisode={(episode, preparation) => setSelection((previous) => ({ id: entry.id, episode, preparation, intent: previous.intent + 1 }))} onRevealSource={() => { if (layout === 'dock') setLayout('cinema') }} onDetails={() => { if (layout !== 'window') setLayout('dock'); onDetails(entry.id) }} /> : <div className="cinema-empty"><Film size={38} /><h3>{entries.length ? 'Choose your next watch' : 'Your cinema starts here'}</h3><p>{entries.length ? 'Pick a title from your library to open its watch desk.' : 'Add a show or movie to your library, then press Watch.'}</p>{!entries.length && <button className="cinema-button primary" onClick={onClose}>Back to gptNime</button>}</div>}
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

type Source = { url: string; name: string; key: string; local: boolean; autoplay?: boolean; provider?: 'wco' }

function EpisodePlayer({ entry, episode, intent, preparation, onComplete, onEpisode, onDetails, onRevealSource }: {
  entry: WatchTitle; episode: number; intent: number; preparation?: Preparation; onComplete: Props['onComplete']; onEpisode: (episode: number, preparation?: Preparation) => void; onDetails: () => void; onRevealSource: () => void
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
  const [providerAvailable, setProviderAvailable] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preparationJob, setPreparationJob] = useState('')
  const [providerPhase, setProviderPhase] = useState('opening')
  const [providerAttention, setProviderAttention] = useState(false)
  const [playbackPage, setPlaybackPage] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const autoplayAttempted = useRef(false)
  const resolutionRef = useRef<AbortController | null>(null)
  const providerBrowserRef = useRef<'chrome' | 'brave'>('chrome')
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

  useEffect(() => { setPlaybackPage(savedPage || '') }, [savedPage])

  useEffect(() => {
    const controller = new AbortController()
    void localPlaybackBrowser().then(async (browser) => {
      if (controller.signal.aborted) return
      providerBrowserRef.current = browser
      const response = await fetch('/api/wco/status', { signal: controller.signal, headers: { 'X-WCO-Browser': browser } })
      const result = await response.json()
      if (!controller.signal.aborted) setProviderAvailable(result.available === true)
    }).catch(() => {})
    return () => { controller.abort(); resolutionRef.current?.abort() }
  }, [])

  useEffect(() => {
    if (!preparing || !preparationJob) return
    const controller = new AbortController()
    let timer = 0
    const poll = async () => {
      try {
        const response = await fetch('/api/wco/status', { signal: controller.signal, headers: { 'X-WCO-Browser': providerBrowserRef.current } })
        const status = await response.json()
        if (!controller.signal.aborted && status.requestId === preparationJob && typeof status.phase === 'string') setProviderPhase(status.phase)
      } catch { /* Preparation reports any terminal error through its own request. */ }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [preparing, preparationJob])

  const showProvider = async () => {
    try {
      const response = await fetch('/api/wco/focus', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WCO-Browser': providerBrowserRef.current }, body: '{}' })
      if (!response.ok) throw new Error()
    } catch { setError('The WCO window is not open. Retry playback to open your saved session.') }
  }

  const cancelPreparation = () => {
    resolutionRef.current?.abort()
    resolutionRef.current = null
    setPreparing(false)
  }

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
    const timer = window.setTimeout(() => setMediaError(source?.provider === 'wco' ? 'WCO’s video is taking longer than expected. Retry this episode to prepare a fresh source.' : 'This source is taking longer than expected. Check the video URL or choose another source.'), 15000)
    return () => window.clearTimeout(timer)
  }, [loading, source?.url, source?.provider])

  const updateSettings = (patch: Partial<ReturnType<typeof readWatchState>>) => {
    const next = { ...readWatchState(), ...patch }
    setSettings(next)
    if (!writeWatchState(next)) setError('Browser storage is unavailable. Your choices will last for this session only.')
  }

  const chooseTab = (next: typeof tab) => {
    if (next !== tab) cancelPreparation()
    setTab(next); setError(''); updateSettings({ sourceTab: next })
  }

  const clearSource = () => {
    cancelPreparation()
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
    autoplayAttempted.current = false
    playedRanges.current = []
    setSource(next); setLoading(true); setError(''); setNotice('')
  }

  const prepareEpisode = async (options: Preparation = {}) => {
    const language = options.language || settings.language
    const state = readWatchState()
    const url = options.url || (!options.search ? state.pages[`${entry.anilistId}:${episode}:${language}`] || state.pages[`${entry.anilistId}:title:${language}`] : undefined)
    const titles = [...new Set((options.search ? [searchTitle] : [entry.titleEnglish, entry.title, ...(entry.synonyms || [])])
      .filter((title): title is string => !!title && title.trim().length >= 2 && title.length <= 200))].slice(0, 8)
    cancelPreparation()
    const controller = new AbortController()
    resolutionRef.current = controller
    const requestId = crypto.randomUUID()
    setPreparationJob(requestId); setProviderPhase('opening')
    setPreparing(true); setError(''); setNotice(''); setMatches([]); setProviderAttention(false)
    videoRef.current?.pause()
    try {
      // Give a cancelled preparation time to release its work tab.
      let response: Response
      for (let attempt = 0; ; attempt++) {
        response = await fetch('/api/wco/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WCO-Request': requestId, 'X-WCO-Browser': providerBrowserRef.current }, signal: controller.signal,
          body: JSON.stringify({ url, titles, episode, language, movie, choose: options.choose === true }),
        })
        if (response.status !== 409 || attempt >= 5) break
        await response.body?.cancel()
        await new Promise<void>((resolve, reject) => {
          const abort = () => { window.clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
          const timer = window.setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve() }, 300 * (attempt + 1))
          controller.signal.addEventListener('abort', abort, { once: true })
          if (controller.signal.aborted) abort()
        })
      }
      const result = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) {
        setProviderAttention(result.code === 'verification' || result.code === 'access')
        throw new Error(result.error || 'WCO could not prepare this episode.')
      }
      if (result.kind === 'choices') {
        const choices: Match[] = Array.isArray(result.choices) ? result.choices.filter((match: Match) => typeof match.title === 'string' && typeof match.url === 'string' && wcoPage(match.url)) : []
        if (!choices.length) throw new Error('No matching title was found. Try another title in Source options.')
        setMatches(choices); setNotice(result.message || 'Choose the matching title.'); onRevealSource()
        return
      }
      const videoUrl = typeof result.source === 'string' && mediaUrl(result.source)
      const resolvedPage = typeof result.pageUrl === 'string' && wcoPage(result.pageUrl)
      if (!videoUrl || !resolvedPage) throw new Error('WCO did not return a supported episode source.')
      const resolvedLanguage: Language = result.language === 'sub' || result.language === 'dub' ? result.language : language
      const pages = { ...readWatchState().pages, [`${entry.anilistId}:${episode}:${resolvedLanguage}`]: resolvedPage }
      const series = result.seriesPage || (url && new URL(url).pathname.startsWith('/anime/') ? url : undefined)
      if (typeof series === 'string' && wcoPage(series)) pages[`${entry.anilistId}:title:${resolvedLanguage}`] = series
      if (episode > 1 && typeof result.previousPage === 'string' && wcoPage(result.previousPage)) pages[`${entry.anilistId}:${episode - 1}:${resolvedLanguage}`] = result.previousPage
      if (typeof result.nextPage === 'string' && wcoPage(result.nextPage)) pages[`${entry.anilistId}:${episode + 1}:${resolvedLanguage}`] = result.nextPage
      updateSettings({ pages, language: resolvedLanguage })
      chooseSource({ url: videoUrl, name: result.title || `${entry.title} · ${episodeLabel(entry, episode)}`, key: sourceFingerprint(resolvedPage), local: false, autoplay: true, provider: 'wco' })
      if (result.notice) setNotice(result.notice)
    } catch (error) {
      if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'WCO could not prepare this episode. Try again.'); onRevealSource() }
    } finally {
      if (resolutionRef.current === controller) { resolutionRef.current = null; setPreparing(false) }
    }
  }

  // Changes to saved pages or bookmarks must not restart a playing episode.
  const autoPrepare = useRef(() => {})
  autoPrepare.current = () => { if (tab === 'wco') void prepareEpisode(preparation) }
  useEffect(() => {
    if (providerAvailable && intent > 0) autoPrepare.current()
  }, [providerAvailable, intent])

  const applyPage = (value: string, language?: Language) => {
    const url = wcoPage(value)
    if (!url) { setError('Use a WCO episode or series page beginning with https://.'); return }
    const path = new URL(url).pathname
    const namedEpisode = path.match(/\bepisode-(\d+)/i)
    const selectedEpisode = !movie && namedEpisode ? Number(namedEpisode[1]) : episode
    if (movie && namedEpisode) { setError('That link is a TV episode. Choose a movie page for this title.'); return }
    if (selectedEpisode < 1 || (entry.episodesTotal && selectedEpisode > entry.episodesTotal)) { setError('That episode is outside this title’s episode list. Choose the matching title first.'); return }
    const selectedLanguage = /\bsubbed\b/i.test(path) ? 'sub' : /\bdubbed\b/i.test(path) ? 'dub' : language || settings.language
    updateSettings({ language: selectedLanguage })
    if (selectedEpisode !== episode) onEpisode(selectedEpisode, { url, language: selectedLanguage })
    else void prepareEpisode({ url, language: selectedLanguage })
  }

  const openProvider = (url?: string) => {
    cancelPreparation()
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
            if (!video.dataset.cinemaMoving && bookmark && bookmark.time > 3 && bookmark.time < video.duration - 5 && Math.abs(bookmark.duration - video.duration) < 2) { video.currentTime = bookmark.time; setNotice((previous) => `${previous ? `${previous} ` : ''}Resumed at ${clockLabel(bookmark.time)}.${source.autoplay ? '' : ' Press play when you’re ready.'}`) }
          }} onCanPlay={() => {
            setLoading(false); setMediaError('')
            const video = videoRef.current
            if (video && source.autoplay && !autoplayAttempted.current && !video.dataset.cinemaMoving) {
              autoplayAttempted.current = true
              void video.play().catch((error) => { if (error?.name !== 'AbortError' && videoRef.current === video) setNotice((previous) => `${previous ? `${previous} ` : ''}Press play to start; your browser requires another click.`) })
            }
          }} onWaiting={() => setLoading(true)} onPlaying={() => { setLoading(false); setMediaError(''); setEnded(false) }} onTimeUpdate={handleTime} onPause={saveBookmark} onEnded={() => { handleTime(); saveBookmark(); setEnded(true) }} onError={() => { setLoading(false); setMediaError(source.provider === 'wco' ? 'WCO’s video could not load in this browser. Retry this episode to prepare a fresh source for your browser.' : 'This video could not be played. Check that the link points to a supported video file, or try an MP4 / WebM file.') }}>
          {subtitle && <track key={subtitle.url} src={subtitle.url} kind="subtitles" srcLang="en" label={subtitle.name} default onError={() => setError('These subtitles could not be loaded. Choose a valid WebVTT (.vtt) file.')} />}
        </video>
        {loading && !mediaError && <span className="cinema-loading" role="status">Loading video…</span>}
        {mediaError && <div className="cinema-media-error" role="alert"><Film size={26} /><p>{mediaError}</p>{source.provider === 'wco' && <button className="cinema-button primary" disabled={preparing} onClick={() => { chooseTab('wco'); void prepareEpisode() }}>{preparing ? 'Preparing episode…' : 'Retry episode'}</button>}<button className="cinema-button" onClick={clearSource}>Choose another source</button></div>}
      </> : <div className="cinema-screen-intro">
        <span className="cinema-night-tag"><span /> YOUR AFTER-HOURS ESCAPE</span>
        <span className="cinema-screen-episode">{episodeLabel(entry, episode)}{!movie && entry.episodesTotal ? ` / ${entry.episodesTotal}` : ''}</span>
        <h3>{entry.title}</h3>
        <p>{metadataTitle && !/^Episode \d+$/i.test(metadataTitle) ? metadataTitle : movie ? 'Settle in. Make it a movie night.' : 'Your next episode, your own little cinema.'}</p>
        <button className="cinema-button primary cinema-start" disabled={preparing} onClick={() => tab === 'wco' ? providerAvailable ? void prepareEpisode() : openProvider(savedPage) : tab === 'file' ? fileRef.current?.click() : hostUrlInput()}><Play size={18} fill="currentColor" />{preparing ? providerPhase === 'verification' ? 'Waiting for WCO verification…' : 'Preparing episode…' : tab === 'wco' ? providerAvailable ? movie ? 'Play movie here' : `Play episode ${episode}` : savedPage ? 'Open saved WCO page' : 'Find on WCO' : tab === 'file' ? 'Choose episode file' : 'Add a video URL'}</button>
        <span className="cinema-screen-footnote">{tab === 'wco' && !providerAvailable ? 'WCO plays in a separate provider window' : 'Plays here, in your cinema'}</span>
      </div>}
    </div>
    <div className="cinema-now-playing"><span><b>{episodeLabel(entry, episode)}</b>{watched && <em><Check size={13} /> Watched</em>}{source && <small title={source.name}>{source.name}</small>}</span><span className="cinema-time">{source ? `${clockLabel(currentTime)} / ${clockLabel(duration)}` : preparing ? providerPhase === 'verification' ? 'WAITING FOR VERIFICATION' : 'PREPARING YOUR VIDEO' : movie ? 'MOVIE NIGHT' : 'READY WHEN YOU ARE'}</span></div>
    <div className="cinema-controls">
      <div className="cinema-episode-navigation">
        <button className="cinema-icon" aria-label="Previous episode in cinema" disabled={episode <= 1 || movie} onClick={() => onEpisode(episode - 1)}><ChevronLeft size={18} /></button>
        {movie ? <span className="cinema-feature"><Film size={16} /> Feature film</span> : <label>Episode <input aria-label="Cinema episode number" type="number" min="1" max={entry.episodesTotal || undefined} key={episode} defaultValue={episode} onBlur={(event) => { const value = Number(event.currentTarget.value); if (Number.isInteger(value) && value >= 1 && (!entry.episodesTotal || value <= entry.episodesTotal)) { if (value !== episode) onEpisode(value) } else event.currentTarget.value = String(episode) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /><span>{entry.episodesTotal ? `of ${entry.episodesTotal}` : ''}</span></label>}
        <button className="cinema-icon" aria-label="Next episode in cinema" disabled={!nextAvailable} onClick={() => onEpisode(episode + 1)}><ChevronRight size={18} /></button>
      </div>
      <button className="cinema-button cinema-mark" disabled={watched} onClick={() => { markedRef.current = true; onComplete(entry.id, episode) }}><Check size={16} />{watched ? 'Watched' : episode > entry.progress + 1 ? `Mark through ep ${episode}` : movie ? 'Mark movie watched' : 'Mark watched'}</button>
      <button className="cinema-icon cinema-details-link" aria-label="Open title details" title="Title details" onClick={onDetails}><ExternalLink size={16} /></button>
    </div>
    {ended && <div className="cinema-finished" role="status"><span><Check size={17} />{nextAvailable ? 'Ready for the next episode?' : 'That’s a wrap. Thanks for watching.'}</span>{nextAvailable && <button className="cinema-button primary" onClick={() => onEpisode(episode + 1)}>Episode {episode + 1}<ChevronRight size={16} /></button>}</div>}
    <div className="cinema-source-desk">
      <div className="cinema-source-heading"><span className="eyebrow">Watch your way</span><span>Choose a source</span></div>
      <div className="cinema-source-tabs" role="group" aria-label="Video source">
        <button className={tab === 'wco' ? 'is-active' : ''} aria-pressed={tab === 'wco'} onClick={() => chooseTab('wco')}><Play size={17} /><span>WCO<small>{providerAvailable ? 'Play in cinema' : 'Provider window'}</small></span></button>
        <button className={tab === 'file' ? 'is-active' : ''} aria-pressed={tab === 'file'} onClick={() => chooseTab('file')}><FolderOpen size={18} /><span>Your files<small>Play in cinema</small></span></button>
        <button className={tab === 'url' ? 'is-active' : ''} aria-pressed={tab === 'url'} onClick={() => chooseTab('url')}><Link2 size={18} /><span>Video URL<small>Play in cinema</small></span></button>
      </div>
      {tab === 'wco' && <div className="cinema-provider-panel">
        <div className="cinema-provider-description"><p>{providerAvailable ? 'Pick an episode. We’ll find it and start your cinema.' : 'Find the show on WCO, then save its page for next time.'}</p><div className="cinema-language" role="group" aria-label="WCO language">{(['sub', 'dub'] as Language[]).map((language) => <button key={language} aria-pressed={settings.language === language} className={settings.language === language ? 'is-active' : ''} onClick={() => {
          if (language === settings.language) return
          updateSettings({ language })
          if (providerAvailable && (intent > 0 || source || preparing || matches.length)) void prepareEpisode({ language })
        }}>{language === 'sub' ? 'Subbed' : 'Dubbed'}</button>)}</div></div>
        {providerAvailable && <>
          <div className="cinema-auto-actions">
            {preparing ? <button className="cinema-button" type="button" onClick={(event) => { event.preventDefault(); cancelPreparation() }}><X size={16} />Cancel</button> : <button className="cinema-button primary" onClick={() => void prepareEpisode()}><Play size={16} />{source ? 'Reload episode' : error ? 'Retry playback' : movie ? 'Play movie' : `Play episode ${episode}`}</button>}
            <button className="cinema-text-button" disabled={preparing} onClick={() => void prepareEpisode({ search: true, choose: true })}><Search size={14} />Find another match</button>
          </div>
          {preparing && <div className={`cinema-preparation${providerPhase === 'verification' ? ' needs-verification' : ''}`} role="status">
            <p>{providerPhase === 'verification' ? 'WCO needs verification. Use Show WCO window to complete the check; playback continues here when WCO accepts it.' : providerPhase === 'searching' ? `Finding ${movie ? 'your movie' : `episode ${episode}`} on WCO…` : providerPhase === 'opening' ? 'Opening your WCO session…' : 'Preparing your video…'}</p>
            <button className="cinema-button" onClick={() => void showProvider()}><ExternalLink size={14} />Show WCO window</button>
            {providerPhase === 'verification' && <small>Your WCO session stays open. If the check keeps returning after you click it, WCO has not accepted verification yet.</small>}
          </div>}
          {matches.length > 0 && <div className="cinema-matches" aria-label="WCO title matches">{matches.map((match) => <button className="cinema-button" key={match.url} onClick={() => applyPage(match.url, match.language)}><Play size={15} /><span>{match.title}</span><ChevronRight size={15} /></button>)}</div>}
        </>}
        <details className="cinema-source-options"><summary>Source options</summary>
        {providerAvailable && <>
          <form className="cinema-search-form" onSubmit={(event) => { event.preventDefault(); void prepareEpisode({ search: true, choose: true }) }}>
            <input aria-label="Search WCO titles" value={searchTitle} onChange={(event) => setSearchTitle(event.target.value)} required minLength={2} maxLength={200} />
            <button className="cinema-button" disabled={preparing}><Search size={15} />Search titles</button>
          </form>
          <form className="cinema-url-panel" onSubmit={(event) => { event.preventDefault(); if (!preparing) applyPage(playbackPage) }}>
            <label>Use a specific WCO page<input data-wco-playback aria-label="WCO playback URL" type="url" value={playbackPage} onChange={(event) => setPlaybackPage(event.target.value)} placeholder="Optional: https://www.wco.tv/…" required disabled={preparing} /></label>
            <button className="cinema-button" type="submit" disabled={preparing}><Play size={16} />Use this link</button>
            <p className="cinema-hint">Optional. An episode link selects its episode and language automatically.</p>
          </form>
        </>}
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
        </details>
        <p className="cinema-hint">{providerAvailable ? 'Episodes prepare in the background using a saved WCO session for your browser. Show the WCO window if verification or sign-in is needed.' : 'WCO requires its own window. Availability, sign-in and playback are managed there; mark progress here when you finish.'}</p>
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
      {error && providerAttention && tab === 'wco' && <button className="cinema-button" onClick={() => void showProvider()}><ExternalLink size={14} />Open WCO session</button>}
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
