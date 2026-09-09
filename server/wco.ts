import { access } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { Page, Response } from 'playwright'
import { backgroundRunner, WcoBrowser, WcoBrowserError, wcoProfileDirectory } from './wcoBrowser'
import { PreparationBusy, WcoPreparation } from './wcoPreparation'

const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const bravePath = process.env.BRAVE_PATH || '/usr/bin/brave-browser'
export function providerBrowser(value: unknown): 'chrome' | 'brave' | null {
  return value === undefined || value === 'chrome' ? 'chrome' : value === 'brave' ? 'brave' : null
}
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
const deadlineMs = 120_000
const verificationMs = 600_000
export type ProviderPhase = 'opening' | 'searching' | 'verification' | 'preparing'
type ReportPhase = (phase: ProviderPhase) => void
type ResumePoint = { pageUrl: string; language: 'sub' | 'dub'; notice: string; seriesPage?: string; reload?: boolean }
class PlaybackError extends Error {
  constructor(message: string, readonly code?: 'verification' | 'access') { super(message) }
}

export function providerAccessMessage(body: string, movie = false): string | null {
  if (/this video is for premium users/i.test(body)) return `WCO restricts this ${movie ? 'movie' : 'episode'} to premium accounts. If you already have access, sign in in the WCO window, then retry. Your WCO session is saved.`
  return null
}

export function episodePage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if (!['www.wco.tv', 'wco.tv'].includes(url.hostname)) return null
    if (!/^\/(?:anime\/)?[a-z0-9][a-z0-9-]*\/?$/i.test(url.pathname)) return null
    if ([...url.searchParams.keys()].some((key) => key !== 'season')) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function videoSource(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.endsWith('.wcostream.com') && url.pathname === '/getvid' && !!url.searchParams.get('evid')
  } catch { return false }
}

type ResolveRequest = { url?: string; titles: string[]; episode: number; language: 'sub' | 'dub'; movie: boolean; choose: boolean; refresh?: boolean; intent?: boolean }
type Link = { url: string; title: string }
type PlaybackSource = {
  kind: 'source'; source: string; pageUrl: string; seriesPage?: string; title: string; language: 'sub' | 'dub'; notice: string
  previousPage: string | null; nextPage: string | null
  playbackId?: string; cached?: boolean
}
type ResolveResult = PlaybackSource | { kind: 'choices'; message: string; choices: (Link & { language?: 'sub' | 'dub' })[] }

// Briefly reuse an already prepared episode when returning to it or switching
// versions. These signed sources stay in server memory and never cross browsers.
export class RecentSources {
  private entries = new Map<string, { result: PlaybackSource; expires: number; created: number; timer: ReturnType<typeof setTimeout> }>()
  constructor(private now: () => number = Date.now) {}
  private forget(key: string) {
    clearTimeout(this.entries.get(key)?.timer)
    this.entries.delete(key)
  }
  private key(pageUrl: string, episode: number, language: string, movie: boolean) {
    const url = new URL(pageUrl)
    return JSON.stringify([url.pathname.replace(/\/$/, ''), episode, language, movie])
  }
  get(pageUrl: string, episode: number, language: string, movie: boolean, refresh = false) {
    const key = this.key(pageUrl, episode, language, movie)
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.forget(key)
    if (refresh) this.forget(key)
    return this.entries.get(key)?.result
  }
  expiresAt(result: PlaybackSource, episode: number, movie: boolean) {
    return this.entries.get(this.key(result.pageUrl, episode, result.language, movie))?.expires || 0
  }
  put(result: PlaybackSource, episode: number, movie: boolean) {
    const key = this.key(result.pageUrl, episode, result.language, movie)
    this.forget(key)
    const timer = setTimeout(() => this.entries.delete(key), 90_000)
    timer.unref()
    result.playbackId = randomUUID()
    this.entries.set(key, { result, expires: this.now() + 90_000, created: this.now(), timer })
    if (this.entries.size > 8) this.forget(this.entries.keys().next().value!)
  }
  retain(playbackId: string): boolean {
    for (const [key, entry] of this.entries) {
      if (entry.result.playbackId !== playbackId) continue
      // A playing cinema can keep its own source ready for refresh. No revival
      // after expiry, unlimited retention, or sharing between browser profiles.
      const now = this.now()
      if (entry.expires <= now || entry.created + 4 * 60 * 60_000 <= now) { this.forget(key); return false }
      clearTimeout(entry.timer)
      entry.expires = Math.min(now + 90_000, entry.created + 4 * 60 * 60_000)
      entry.timer = setTimeout(() => this.entries.delete(key), entry.expires - now)
      entry.timer.unref()
      return true
    }
    return false
  }
}
const recentSources = new WeakMap<WcoBrowser, RecentSources>()
function requestKey(request: ResolveRequest) {
  return JSON.stringify({ url: request.url, titles: request.titles, episode: request.episode, language: request.language, movie: request.movie, choose: request.choose })
}

export function titleKey(title: string, movie = false): string {
  let value = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(?:english\s+)?(?:dubbed|subbed)\b|\((?:dub|sub|tv)\)/g, '')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, 'season $1').replace(/&/g, 'and')
  if (movie) value = value.replace(/\b(?:the\s+)?movie\b/g, '')
  return value.replace(/[^a-z0-9]/g, '')
}

export function linkLanguage(link: Link): 'sub' | 'dub' | undefined {
  if (/\bsubbed\b/i.test(`${link.title} ${link.url}`)) return 'sub'
  if (/\bdubbed\b/i.test(`${link.title} ${link.url}`)) return 'dub'
}

export function searchCandidates(links: Link[], movie: boolean): Link[] {
  const seen = new Set<string>()
  return links.filter((link) => {
    const url = episodePage(link.url)
    if (!url || !link.title.trim() || (movie ? new URL(url).pathname.startsWith('/anime/') || /\bepisode[\s-]+\d/i.test(`${link.title} ${url}`) : !new URL(url).pathname.startsWith('/anime/'))) return false
    const key = new URL(url).pathname.replace(/\/$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function automaticMatch(links: Link[], titles: string[], language: 'sub' | 'dub', movie: boolean): Link | null {
  const keysFor = (title: string) => movie ? [titleKey(title, true), movieTitleKey(title)] : [titleKey(title)]
  const keys = new Set(titles.flatMap(keysFor).filter(Boolean))
  const exact = searchCandidates(links, movie).filter((link) => keysFor(link.title).some((key) => keys.has(key)))
  return preferredMatch(exact, language)
}

// Film names sometimes reverse the franchise and subtitle around a colon.
// Preserve each complete part and all numbers; never match on franchise alone.
function movieTitleKey(title: string): string {
  return title.split(':').map((part) => titleKey(part, true)).filter(Boolean).sort().join(':')
}

export function movieSearchQueries(titles: string[]): string[] {
  return [...new Set(titles.map((title) => title.replace(/\b(?:the\s+)?movie\b/gi, '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 3)
}

export function relevantMovieCandidates(links: Link[], titles: string[]): Link[] {
  // WCO's search matches common words independently. Do not offer an unrelated
  // film merely because both names contain "The Movie" or a Japanese "hen".
  const words = (title: string) => new Set(title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '').toLowerCase()
    .replace(/\b(?:english|dubbed|subbed|the|a|an|of|and|movie|gekijouban|hen)\b/g, ' ').match(/[a-z0-9]+/g) || [])
  const aliases = titles.map(words).filter((tokens) => tokens.size)
  return searchCandidates(links, true).map((link) => {
    const tokens = words(link.title)
    const score = Math.max(0, ...aliases.map((alias) => {
      const overlap = [...alias].filter((word) => tokens.has(word)).length
      return overlap >= Math.min(2, alias.size) ? overlap / Math.max(tokens.size, alias.size) : 0
    }))
    return { link, score }
  }).filter(({ score }) => score >= 0.4).sort((a, b) => b.score - a.score).map(({ link }) => link)
}

function preferredMatch(exact: Link[], language: 'sub' | 'dub'): Link | null {
  const preferred = exact.filter((link) => linkLanguage(link) === language)
  const neutral = exact.filter((link) => !linkLanguage(link))
  const candidates = preferred.length ? preferred : neutral.length ? neutral : exact
  return candidates.length === 1 ? candidates[0] : null
}

export function searchEpisodeCandidates(links: Link[], titles: string[], episode: number): Link[] {
  const keys = new Set(titles.map((title) => titleKey(title)).filter(Boolean))
  const seen = new Set<string>()
  return links.filter((link) => {
    const named = link.title.match(/\bepisode\s+(\d+)(?!\d)/i)
    if (!episodePage(link.url) || new URL(link.url).pathname.startsWith('/anime/') || !named || Number(named[1]) !== episode || seen.has(link.url)) return false
    // Compare the full show/season prefix, not an arbitrary substring or slug.
    if (!keys.has(titleKey(link.title.slice(0, named.index)))) return false
    seen.add(link.url)
    return true
  })
}

export async function searchLinks(page: Page): Promise<Link[]> {
  return page.locator('#sidebar_right2 .items .recent-release-episodes a[href], #sidebar_right2 .ul-episodes a[href]').evaluateAll((links) => links.map((link) => ({
    url: (link as HTMLAnchorElement).href, title: link.textContent?.trim() || '',
  })))
}

export class PreparationBudget {
  end: number
  verificationRemaining: number
  constructor(workMs = deadlineMs, humanMs = verificationMs) {
    this.end = Date.now() + workMs
    this.verificationRemaining = humanMs
  }
  accountVerification(elapsed: number) {
    this.end += elapsed
    this.verificationRemaining = Math.max(0, this.verificationRemaining - elapsed)
  }
}

export async function waitForProvider(page: Page, budget: PreparationBudget, signal: AbortSignal, report: ReportPhase, resume: ProviderPhase) {
  let started = 0
  try {
    while (true) {
      signal.throwIfAborted()
      if (page.isClosed()) throw new PlaybackError('The WCO window was closed. Retry playback to continue with its saved session.')
      const title = await page.title().catch(() => '')
      if (!/just a moment|attention required|verify you are human/i.test(title)) return
      if (!started) { started = Date.now(); report('verification') }
      if (Date.now() - started >= budget.verificationRemaining) throw new PlaybackError('WCO still has not accepted verification. Your WCO session is kept. Complete the check in its browser window, then retry playback. If it keeps looping there, the provider is still rejecting that session.', 'verification')
      // Observe only. Never click, reload or inject code into a human challenge.
      await page.waitForTimeout(500)
    }
  } finally {
    if (started) budget.accountVerification(Date.now() - started)
    report(resume)
  }
}

async function discover(page: Page, request: ResolveRequest, budget: PreparationBudget, signal: AbortSignal, report: ReportPhase) {
  const queries = request.movie ? movieSearchQueries(request.titles) : [...new Set([...request.titles.slice(0, 2), request.titles[0]?.split(':')[0], ...request.titles.slice(2)].filter(Boolean))].slice(0, 3)
  let candidates: Link[] = []
  report('searching')
  const search = async (query: string, scope: 'episodes' | 'series') => {
    await waitForProvider(page, budget, signal, report, 'searching')
    if (Date.now() >= budget.end) throw new PlaybackError('WCO title lookup took too long. Retry playback to continue with your saved session.')
    // Submit the public search form directly, avoiding an extra homepage load.
    // Normal top-level navigation retains the dedicated browser's own session.
    await page.goto('about:blank')
    await page.evaluate(({ query, scope }) => {
      const form = document.createElement('form')
      form.method = 'POST'; form.action = 'https://www.wco.tv/search'
      for (const [name, value] of Object.entries({ catara: query, konuara: scope })) {
        const input = document.createElement('input')
        input.name = name; input.value = value; form.append(input)
      }
      document.body.append(form)
    }, { query, scope })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {}),
      page.locator('form').evaluate((form: HTMLFormElement) => form.submit()),
    ])
    await waitForProvider(page, budget, signal, report, 'searching')
    if (new URL(page.url()).hostname !== 'www.wco.tv' || new URL(page.url()).pathname !== '/search') throw new PlaybackError('WCO search is unavailable right now. Retry playback shortly.')
    return searchLinks(page)
  }
  for (const query of queries) {
    if (!request.movie && !request.choose) {
      const episodes = searchEpisodeCandidates(await search(`${query} episode ${request.episode}`, 'episodes'), request.titles, request.episode)
      const match = preferredMatch(episodes, request.language)
      if (match) return { match, candidates: episodes }
      if (episodes.length) return { match: null, candidates: episodes.slice(0, 8) }
    }
    const results = await search(query, request.movie ? 'episodes' : 'series')
    candidates = searchCandidates([...candidates, ...results], request.movie)
    const match = automaticMatch(candidates, request.titles, request.language, request.movie)
    if (match && !request.choose) return { match, candidates }
    if (request.choose && (request.movie ? relevantMovieCandidates(candidates, request.titles) : candidates).length) break
  }
  if (request.movie) {
    candidates = relevantMovieCandidates(candidates, request.titles)
    if (!candidates.length) {
      // The movie catalogue may contain a film absent from public search. Read
      // its normal page, including its access state, in this same saved session.
      signal.throwIfAborted()
      if (Date.now() >= budget.end) throw new PlaybackError('WCO movie lookup took too long. Retry playback to continue with your saved session.')
      await page.goto('https://www.wco.tv/movie-list', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
      await waitForProvider(page, budget, signal, report, 'searching')
      if (new URL(page.url()).hostname !== 'www.wco.tv' || new URL(page.url()).pathname !== '/movie-list') throw new PlaybackError('WCO’s movie catalogue is unavailable right now. Retry playback shortly.')
      if (providerAccessMessage(await page.locator('body').innerText().catch(() => ''), true)) {
        throw new PlaybackError('This film was not found in WCO’s public search, and its movie catalogue requires premium access. If you have access, sign in in the WCO window, then retry.', 'access')
      }
      const links = await page.locator('#sidebar_right2 a[href]').evaluateAll((links) => links.map((link) => ({ url: (link as HTMLAnchorElement).href, title: link.textContent?.trim() || '' })))
      const match = automaticMatch(links, request.titles, request.language, true)
      candidates = relevantMovieCandidates(links, request.titles)
      if (match && !request.choose) return { match, candidates }
    }
  }
  return { match: null, candidates: candidates.slice(0, 8) }
}

export function selectionError(title: string, request: Pick<ResolveRequest, 'episode' | 'language' | 'movie'>): string | null {
  const namedEpisode = title.match(/\bepisode\s+(\d+)/i)
  if (request.movie && namedEpisode) return 'That is an episode page. Use the movie’s exact WCO page.'
  if (!request.movie && namedEpisode && Number(namedEpisode[1]) !== request.episode) {
    return `That page is for episode ${namedEpisode[1]}. Select that episode in the cinema or use a matching link.`
  }
  if (request.language === 'sub' && /english dubbed/i.test(title)) return 'That page is dubbed. Choose Dubbed in the cinema to use this link.'
  if (request.language === 'dub' && /english subbed/i.test(title)) return 'That page is subbed. Choose Subbed in the cinema to use this link.'
  return null
}

export function matchingEpisodes(links: Link[], episode: number, language: 'sub' | 'dub'): string[] {
  const number = new RegExp(`\\bepisode[\\s-]+${episode}(?!\\d)`, 'i')
  const languagePattern = language === 'dub' ? /dubbed/i : /subbed/i
  return [...new Set(links.filter((link) => episodePage(link.url) && number.test(`${link.title} ${link.url}`) &&
    languagePattern.test(`${link.title} ${link.url}`)).map((link) => episodePage(link.url)!))]
}

export async function episodeLinks(page: Page, catalogue: boolean): Promise<Link[]> {
  // Recent-release sidebars can contain the same episode number from a different
  // show. Read only this series' episode list or the player's own navigation.
  return page.locator(catalogue ? '#episodeList a[href]' : '.prev-next a[href]').evaluateAll((links) => links.map((link) => ({
    url: (link as HTMLAnchorElement).href, title: link.textContent?.trim() || '',
  })))
}

export async function resolveWco(request: ResolveRequest, signal: AbortSignal, session: WcoBrowser, resumes: Map<string, ResumePoint>, report: ReportPhase): Promise<ResolveResult> {
  signal.throwIfAborted()
  let cache = recentSources.get(session)
  if (!cache) { cache = new RecentSources(); recentSources.set(session, cache) }
  const remembered = resumes.get(requestKey(request))
  const pageUrl = remembered?.pageUrl || request.url
  if (!request.choose && pageUrl) {
    const cached = cache.get(pageUrl, request.episode, remembered?.language || request.language, request.movie, request.refresh)
    if (cached) return { ...cached, cached: true }
  }
  for (let attempt = 0; ; attempt++) {
    const revision = session.revision
    try {
      const result = await prepareWco(request, signal, session, resumes, report)
      signal.throwIfAborted()
      if (result.kind === 'source') cache.put(result, request.episode, request.movie)
      return result
    }
    catch (error) {
      if (signal.aborted || revision === session.revision || attempt >= 1) throw error
      // The person explicitly opened the hidden session. Continue on its desktop
      // browser after the profile is handed over, keeping this playback request.
      await session.getPage()
    }
  }
}

async function prepareWco(request: ResolveRequest, signal: AbortSignal, session: WcoBrowser, resumes: Map<string, ResumePoint>, report: ReportPhase): Promise<ResolveResult> {
  if (request.movie && request.url?.includes('/anime/')) throw new PlaybackError('Choose the movie result instead of a TV series.')
  const page = await session.getPage()
  const revision = session.revision
  signal.throwIfAborted()
  session.setPreparing(true)
  const acceptedMedia = new Set<string>()
  const observeMedia = (response: Response) => {
    if ([200, 206].includes(response.status()) && /^video\//i.test(response.headers()['content-type'] || '') && videoSource(response.url())) acceptedMedia.add(response.url())
  }
  page.on('response', observeMedia)
  // Cancellation releases the work tab promptly; Chrome's profile survives it.
  let cancellation: Promise<void> | undefined
  const abort = () => { cancellation = session.cancel(page) }
  signal.addEventListener('abort', abort, { once: true })
  const key = requestKey(request)
  const remembered = request.choose ? undefined : resumes.get(key)
  const budget = new PreparationBudget()
  try {
    if (signal.aborted) { abort(); signal.throwIfAborted() }
    let selectedPage = remembered?.pageUrl || request.url
    let language = remembered?.language || request.language
    let languageNotice = remembered?.notice || ''
    if (!selectedPage) {
      const discovery = await discover(page, request, budget, signal, report)
      if (!discovery.match) {
        if (!discovery.candidates.length) throw new PlaybackError('No matching WCO title was found. Try another title search in Source options.')
        return { kind: 'choices', message: 'Choose the matching WCO title.', choices: discovery.candidates.map((link) => ({ ...link, language: linkLanguage(link) })) }
      }
      const selected = new URL(discovery.match.url)
      // Search links can default to a single season. Use WCO’s All Seasons view
      // when discovering an episode, then select from the actual episode list.
      if (selected.pathname.startsWith('/anime/')) selected.searchParams.set('season', 'all')
      selectedPage = selected.href
      const foundLanguage = linkLanguage(discovery.match)
      if (foundLanguage && foundLanguage !== language) {
        language = foundLanguage
        languageNotice = `WCO has this title ${language === 'dub' ? 'dubbed' : 'subbed'}; using that version.`
      }
    }
    let catalogue = selectedPage.includes('/anime/')
    const seriesPage: string | undefined = remembered?.seriesPage || (catalogue ? selectedPage : undefined)
    const remember = () => {
      resumes.set(key, { pageUrl: selectedPage!, language, notice: languageNotice, seriesPage })
      if (resumes.size > 32) resumes.delete(resumes.keys().next().value!)
    }
    remember()
    report('preparing')
    // Retry the same selection without throwing away a check completed meanwhile.
    if (episodePage(page.url()) !== selectedPage || remembered?.reload) await page.goto(selectedPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    while (Date.now() < budget.end) {
      signal.throwIfAborted()
      if (page.isClosed()) throw new PlaybackError('The WCO preparation window was closed. Retry playback to continue.')
      const title = await page.title().catch(() => '')
      // Leave verification controls entirely to the user in the visible window.
      if (/just a moment|attention required|verify you are human/i.test(title)) {
        session.setPreparing(false)
        await waitForProvider(page, budget, signal, report, 'preparing')
        session.setPreparing(true)
        continue
      }
      if (!episodePage(page.url())) throw new PlaybackError('WCO redirected outside its episode pages. Use an exact wco.tv episode link.')
      if (catalogue) {
        const links = await episodeLinks(page, true)
        let matches = matchingEpisodes(links, request.episode, language)
        if (!matches.length) {
          const alternate = language === 'sub' ? 'dub' : 'sub'
          const alternatives = matchingEpisodes(links, request.episode, alternate)
          if (alternatives.length) {
            matches = alternatives; language = alternate
            languageNotice = `WCO has episode ${request.episode} ${language === 'dub' ? 'dubbed' : 'subbed'}; using that version.`
          }
        }
        if (matches.length > 1) return { kind: 'choices', message: 'WCO lists several versions of this episode. Choose the season or edition you want.', choices: links.filter((link) => matches.includes(link.url)).map((link) => ({ ...link, language })) }
        if (!matches.length) {
          const body = await page.locator('body').innerText().catch(() => '')
          if (/episode list/i.test(body)) throw new PlaybackError(`Episode ${request.episode} was not found on this WCO series page. Use Find another match to check other editions.`)
          await page.waitForTimeout(500)
          continue
        }
        selectedPage = matches[0]
        remember()
        catalogue = false
        await page.goto(selectedPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
        continue
      }
      const mismatch = selectionError(title, { ...request, language })
      if (mismatch) throw new PlaybackError(mismatch)
      const accessMessage = providerAccessMessage(await page.locator('body').innerText().catch(() => ''), request.movie)
      if (accessMessage) {
        resumes.set(key, { pageUrl: selectedPage, language, notice: languageNotice, seriesPage, reload: true })
        throw new PlaybackError(accessMessage, 'access')
      }
      const frames = page.frames().filter((frame) => {
        try { return new URL(frame.url()).hostname === 'embed.wcostream.com' } catch { return false }
      })
      for (const frame of frames) {
        const close = frame.getByRole('button', { name: 'Close announcement', exact: true })
        if (await close.isVisible().catch(() => false) && await close.isEnabled().catch(() => false)) {
          await close.click({ timeout: 1000 }).catch(() => {})
          continue
        }
        const video = frame.locator('video').first()
        if (!await video.count()) continue
        const media = await video.evaluate((node: HTMLVideoElement) => {
          node.muted = true
          return { source: node.currentSrc, ready: node.readyState }
        }).catch(() => null)
        if (media && videoSource(media.source) && (media.ready >= 1 || acceptedMedia.has(media.source))) {
          await video.evaluate((node: HTMLVideoElement) => node.pause()).catch(() => {})
          const links = request.movie ? [] : await episodeLinks(page, false)
          const previous = matchingEpisodes(links, request.episode - 1, language)
          const next = matchingEpisodes(links, request.episode + 1, language)
          await session.park(page)
          return {
            kind: 'source', source: media.source, pageUrl: selectedPage, seriesPage, title, language, notice: languageNotice,
            previousPage: previous.length === 1 ? previous[0] : null,
            nextPage: next.length === 1 ? next[0] : null,
          }
        }
        const play = frame.getByRole('button', { name: 'Play Video', exact: true })
        if (await play.isVisible().catch(() => false)) await play.click({ timeout: 1000 }).catch(() => {})
      }
      await page.waitForTimeout(150)
    }
    throw new PlaybackError('WCO did not provide a playable source in time. Try again and complete any verification while its window is open. Premium-only videos need the provider’s own access.')
  } catch (error) {
    const checkpoint = resumes.get(key)
    // Reload failed player initialization on Retry, while preserving an unfinished
    // human check so an accepted verification is not discarded by navigation.
    if (checkpoint && revision === session.revision && !(error instanceof PlaybackError && error.code === 'verification')) resumes.set(key, { ...checkpoint, reload: true })
    throw error
  } finally {
    page.removeListener('response', observeMedia)
    signal.removeEventListener('abort', abort)
    await cancellation?.catch(() => {})
    session.setPreparing(false)
    // Keep the dedicated browser and its cookies, including after verification
    // errors. Closing it on every request caused accepted sessions to be lost.
  }
}

function isLocal(req: IncomingMessage) {
  const address = req.socket.remoteAddress
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) return false
  try { return loopback.has(new URL(`http://${req.headers.host}`).hostname) } catch { return false }
}

function json(res: ServerResponse, status: number, body: object) {
  if (res.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > 4096) throw new Error('Request is too large.')
  }
  return JSON.parse(body)
}

async function readRequest(req: IncomingMessage): Promise<ResolveRequest> {
  const raw = await readJson(req)
  const url = episodePage(raw?.url)
  const titles = Array.isArray(raw?.titles) ? raw.titles : []
  if ((raw?.url && !url) || (!url && !titles.length) || titles.length > 8 || titles.some((title: unknown) => typeof title !== 'string' || title.trim().length < 2 || title.length > 200) || !Number.isInteger(raw?.episode) || raw.episode < 1 || raw.episode > 100_000 || !['sub', 'dub'].includes(raw.language) || typeof raw.movie !== 'boolean' || (raw.choose !== undefined && typeof raw.choose !== 'boolean') || (raw.refresh !== undefined && typeof raw.refresh !== 'boolean') || (raw.intent !== undefined && typeof raw.intent !== 'boolean')) {
    throw new Error('Use a valid title and episode selection.')
  }
  return { url: url || undefined, titles: titles.map((title: string) => title.trim()), episode: raw.episode, language: raw.language, movie: raw.movie, choose: raw.choose === true, refresh: raw.refresh === true, intent: raw.intent === true }
}

export function wcoPlugin(): Plugin {
  // Provider sources can be bound to the preparing browser. Use the installed
  // viewer's browser, without overriding its identity or copying personal data.
  const providers = {
    chrome: { path: chromePath, session: new WcoBrowser(chromePath), resumes: new Map<string, ResumePoint>() },
    brave: { path: bravePath, session: new WcoBrowser(bravePath, `${wcoProfileDirectory}-brave`), resumes: new Map<string, ResumePoint>() },
  }
  const preparation = new WcoPreparation<ResolveResult>()
  const shutdown = async () => { await preparation.close(); await Promise.all(Object.values(providers).map(({ session }) => session.close())) }
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/wco/status' && path !== '/api/wco/resolve' && path !== '/api/wco/prefetch' && path !== '/api/wco/focus' && path !== '/api/wco/retain') { next(); return }
    if (!isLocal(req)) { json(res, 403, { error: 'The WCO connector is available only on this computer.' }); return }
    const browser = providerBrowser(req.headers['x-wco-browser'])
    if (!browser) { json(res, 400, { error: 'Choose a supported local playback browser.' }); return }
    const { session, resumes, path: browserPath } = providers[browser]
    if (path === '/api/wco/status' && req.method === 'GET') {
      const available = await access(browserPath).then(() => true, () => false)
      json(res, 200, { available, browser, automatic: true, persistent: true, hiddenPreparation: !!await backgroundRunner(), ...preparation.status }); return
    }
    if (!['/api/wco/resolve', '/api/wco/prefetch', '/api/wco/focus', '/api/wco/retain'].includes(path) || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed.' }); return }
    if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) {
      json(res, 403, { error: 'Start playback from the local gptNime cinema.' }); return
    }
    if (path === '/api/wco/focus') {
      const shown = await session.show().catch(() => false)
      json(res, shown ? 200 : 409, shown ? { shown: true } : { error: 'Start playback to open the WCO session.' }); return
    }
    if (path === '/api/wco/retain') {
      const body = await readJson(req).catch(() => null)
      if (typeof body?.playbackId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.playbackId)) { json(res, 400, { error: 'Use the current playback session.' }); return }
      json(res, 200, { retained: recentSources.get(session)?.retain(body.playbackId) || false }); return
    }
    let request: ResolveRequest
    try { request = await readRequest(req) } catch { json(res, 400, { error: 'Use a valid title and episode selection.' }); return }
    const background = path === '/api/wco/prefetch'
    if (background && (request.choose || request.refresh || !await backgroundRunner())) { json(res, 400, { error: 'Background preparation is unavailable for this selection.' }); return }
    const controller = new AbortController()
    const rawRequestId = req.headers['x-wco-request']
    const requestId = typeof rawRequestId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(rawRequestId) ? rawRequestId : null
    const cancel = () => controller.abort()
    if (!background) res.once('close', cancel)
    try {
      const key = `${browser}:${requestKey(request)}`
      const work = (signal: AbortSignal, report: ReportPhase) => resolveWco(request, signal, session, resumes, report)
      const result = await (background ? preparation.prefetch(key, work, request.intent) : preparation.resolve(key, work, controller.signal, requestId, request.refresh))
      json(res, 200, background ? { ready: result.kind === 'source', expiresAt: result.kind === 'source' ? recentSources.get(session)?.expiresAt(result, request.episode, request.movie) || 0 : 0 } : result)
    } catch (error) {
      if (error instanceof PreparationBusy) { json(res, 409, { error: 'Another episode is being prepared. Cancel it or wait for it to finish.' }); return }
      // Playwright errors may contain signed URLs. Only our own messages reach UI.
      const message = error instanceof PlaybackError || error instanceof WcoBrowserError
        ? error.message : 'The WCO connection was interrupted. Retry playback to reconnect to your saved session.'
      json(res, 502, { error: message, code: error instanceof PlaybackError ? error.code : undefined })
    } finally {
      res.removeListener('close', cancel)
    }
  }
  return {
    name: 'gptnime-local-wco',
    closeBundle: shutdown,
    configureServer(server) {
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
      server.httpServer?.once('close', shutdown)
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
      server.httpServer.once('close', shutdown)
    },
  }
}
