import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { chromium, type Page } from 'playwright'

const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
const deadlineMs = 120_000
class PlaybackError extends Error {}

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

type ResolveRequest = { url?: string; titles: string[]; episode: number; language: 'sub' | 'dub'; movie: boolean; choose: boolean }
type Link = { url: string; title: string }

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
  const keys = new Set(titles.map((title) => titleKey(title, movie)).filter(Boolean))
  const exact = searchCandidates(links, movie).filter((link) => keys.has(titleKey(link.title, movie)))
  return preferredMatch(exact, language)
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

async function waitForProvider(page: Page, end: number, signal: AbortSignal) {
  while (Date.now() < end) {
    signal.throwIfAborted()
    if (page.isClosed()) throw new PlaybackError('The WCO preparation window was closed. Retry playback to continue.')
    if (!/just a moment|attention required|verify you are human/i.test(await page.title())) return
    await page.waitForTimeout(500)
  }
  throw new PlaybackError('WCO is waiting for verification. Retry and complete its check in the Chrome window.')
}

async function discover(page: Page, request: ResolveRequest, end: number, signal: AbortSignal) {
  const queries = [...new Set([...request.titles.slice(0, 2), request.titles[0]?.split(':')[0], ...request.titles.slice(2)].filter(Boolean))].slice(0, 3)
  let candidates: Link[] = []
  await page.goto('https://www.wco.tv/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  const search = async (query: string, scope: 'episodes' | 'series') => {
    await waitForProvider(page, end, signal)
    await page.locator('input[name="catara"]').fill(query, { timeout: 10_000 })
    await page.locator('select[name="konuara"]').selectOption(scope)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {}),
      page.locator('input[name="catara"]').press('Enter'),
    ])
    await waitForProvider(page, end, signal)
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
    if (request.choose && candidates.length) break
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

async function resolveWco(request: ResolveRequest, signal: AbortSignal) {
  if (request.movie && request.url?.includes('/anime/')) throw new PlaybackError('Choose the movie result instead of a TV series.')
  // A separate, temporary browser profile follows the site's normal page/player
  // flow. It never reads the user's browser profile or solves human challenges.
  const browser = await chromium.launch({ executablePath: chromePath, headless: false, args: ['--mute-audio'] })
  const abort = () => { void browser.close().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 } })
    const page = await context.newPage()
    context.on('page', (popup) => { if (popup !== page) void popup.close().catch(() => {}) })
    const end = Date.now() + deadlineMs
    let selectedPage = request.url
    let language = request.language
    let languageNotice = ''
    if (!selectedPage) {
      const discovery = await discover(page, request, end, signal)
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
    const seriesPage: string | undefined = catalogue ? selectedPage : undefined
    await page.goto(selectedPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    while (Date.now() < end) {
      signal.throwIfAborted()
      if (page.isClosed()) throw new PlaybackError('The WCO preparation window was closed. Press Play here to try again.')
      const title = await page.title().catch(() => '')
      // Leave verification controls entirely to the user in the visible window.
      if (/just a moment|attention required|verify you are human/i.test(title)) {
        await waitForProvider(page, end, signal)
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
        catalogue = false
        await page.goto(selectedPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
        continue
      }
      const mismatch = selectionError(title, { ...request, language })
      if (mismatch) throw new PlaybackError(mismatch)
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
        if (media && videoSource(media.source) && media.ready >= 1) {
          await video.evaluate((node: HTMLVideoElement) => node.pause()).catch(() => {})
          const links = await episodeLinks(page, false)
          const previous = matchingEpisodes(links, request.episode - 1, language)
          const next = matchingEpisodes(links, request.episode + 1, language)
          return {
            kind: 'source', source: media.source, pageUrl: selectedPage, seriesPage, title, language, notice: languageNotice,
            previousPage: previous.length === 1 ? previous[0] : null,
            nextPage: next.length === 1 ? next[0] : null,
          }
        }
        const play = frame.getByRole('button', { name: 'Play Video', exact: true })
        if (await play.isVisible().catch(() => false)) await play.click({ timeout: 1000 }).catch(() => {})
      }
      await page.waitForTimeout(350)
    }
    throw new PlaybackError('WCO did not provide a playable source in time. Try again and complete any verification while its window is open. Premium-only videos need the provider’s own access.')
  } finally {
    signal.removeEventListener('abort', abort)
    await browser.close().catch(() => {})
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

async function readRequest(req: IncomingMessage): Promise<ResolveRequest> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > 4096) throw new Error('Request is too large.')
  }
  const raw = JSON.parse(body)
  const url = episodePage(raw?.url)
  const titles = Array.isArray(raw?.titles) ? raw.titles : []
  if ((raw?.url && !url) || (!url && !titles.length) || titles.length > 8 || titles.some((title: unknown) => typeof title !== 'string' || title.trim().length < 2 || title.length > 200) || !Number.isInteger(raw?.episode) || raw.episode < 1 || raw.episode > 100_000 || !['sub', 'dub'].includes(raw.language) || typeof raw.movie !== 'boolean' || (raw.choose !== undefined && typeof raw.choose !== 'boolean')) {
    throw new Error('Use a valid title and episode selection.')
  }
  return { url: url || undefined, titles: titles.map((title: string) => title.trim()), episode: raw.episode, language: raw.language, movie: raw.movie, choose: raw.choose === true }
}

export function wcoPlugin(): Plugin {
  let active: AbortController | null = null
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/wco/status' && path !== '/api/wco/resolve') { next(); return }
    if (!isLocal(req)) { json(res, 403, { error: 'The WCO connector is available only on this computer.' }); return }
    if (path === '/api/wco/status' && req.method === 'GET') {
      const available = await access(chromePath).then(() => true, () => false)
      json(res, 200, { available, automatic: true, busy: active !== null }); return
    }
    if (path !== '/api/wco/resolve' || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed.' }); return }
    if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) {
      json(res, 403, { error: 'Start playback from the local gptNime cinema.' }); return
    }
    let request: ResolveRequest
    try { request = await readRequest(req) } catch { json(res, 400, { error: 'Use a valid title and episode selection.' }); return }
    if (active) { json(res, 409, { error: 'Another episode is being prepared. Cancel it or wait for it to finish.' }); return }
    const controller = new AbortController()
    active = controller
    const timer = setTimeout(() => controller.abort(), deadlineMs + 15_000)
    const cancel = () => controller.abort()
    res.once('close', cancel)
    try {
      const result = await resolveWco(request, controller.signal)
      json(res, 200, result)
    } catch (error) {
      // Playwright errors may contain signed URLs. Only our own messages reach UI.
      const message = error instanceof PlaybackError
        ? error.message : 'WCO could not prepare this episode. Try again and complete any verification in its browser window.'
      json(res, 502, { error: message })
    } finally {
      clearTimeout(timer)
      res.removeListener('close', cancel)
      if (active === controller) active = null
    }
  }
  return {
    name: 'gptnime-local-wco',
    configureServer(server) {
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
      server.httpServer?.once('close', () => active?.abort())
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
      server.httpServer.once('close', () => active?.abort())
    },
  }
}
