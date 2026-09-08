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

type ResolveRequest = { url: string; episode: number; language: 'sub' | 'dub'; movie: boolean }
type Link = { url: string; title: string }

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
  if (request.movie && request.url.includes('/anime/')) throw new PlaybackError('For a movie, paste its exact WCO movie page.')
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
    let catalogue = request.url.includes('/anime/')
    let selectedPage = request.url
    await page.goto(selectedPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    while (Date.now() < end) {
      signal.throwIfAborted()
      if (page.isClosed()) throw new PlaybackError('The WCO preparation window was closed. Press Play here to try again.')
      const title = await page.title().catch(() => '')
      // Leave verification controls entirely to the user in the visible window.
      if (/just a moment|attention required|verify you are human/i.test(title)) {
        await page.waitForTimeout(500)
        continue
      }
      if (!episodePage(page.url())) throw new PlaybackError('WCO redirected outside its episode pages. Use an exact wco.tv episode link.')
      if (catalogue) {
        const matches = matchingEpisodes(await episodeLinks(page, true), request.episode, request.language)
        if (matches.length > 1) throw new PlaybackError('This series has multiple matching episodes. Paste the exact episode link to choose the right one.')
        if (!matches.length) {
          const body = await page.locator('body').innerText().catch(() => '')
          if (/episode list/i.test(body)) throw new PlaybackError(`No ${request.language === 'dub' ? 'dubbed' : 'subbed'} episode ${request.episode} was found on this series page. Try an exact episode link.`)
          await page.waitForTimeout(500)
          continue
        }
        selectedPage = matches[0]
        catalogue = false
        await page.goto(selectedPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
        continue
      }
      const mismatch = selectionError(title, request)
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
          const previous = matchingEpisodes(links, request.episode - 1, request.language)
          const next = matchingEpisodes(links, request.episode + 1, request.language)
          return {
            source: media.source, pageUrl: selectedPage, title,
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
  if (!url || !Number.isInteger(raw.episode) || raw.episode < 1 || raw.episode > 100_000 || !['sub', 'dub'].includes(raw.language) || typeof raw.movie !== 'boolean') {
    throw new Error('Use a wco.tv episode or series URL and a valid episode selection.')
  }
  return { url, episode: raw.episode, language: raw.language, movie: raw.movie }
}

export function wcoPlugin(): Plugin {
  let active: AbortController | null = null
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/wco/status' && path !== '/api/wco/resolve') { next(); return }
    if (!isLocal(req)) { json(res, 403, { error: 'The WCO connector is available only on this computer.' }); return }
    if (path === '/api/wco/status' && req.method === 'GET') {
      const available = await access(chromePath).then(() => true, () => false)
      json(res, 200, { available, busy: active !== null }); return
    }
    if (path !== '/api/wco/resolve' || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed.' }); return }
    if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) {
      json(res, 403, { error: 'Start playback from the local gptNime cinema.' }); return
    }
    let request: ResolveRequest
    try { request = await readRequest(req) } catch { json(res, 400, { error: 'Use a wco.tv episode or series URL and a valid episode selection.' }); return }
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
