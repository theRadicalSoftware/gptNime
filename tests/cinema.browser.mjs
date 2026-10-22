import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { chromium } from 'playwright'

const base = process.env.CINEMA_URL || 'http://127.0.0.1:5197'
const server = process.env.CINEMA_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], { stdio: 'pipe' })
const output = 'output/cinema'
await mkdir(output, { recursive: true })
let browser
const results = []
const passed = (name) => { results.push(name); process.stdout.write(`✓ ${name}\n`) }
const now = new Date().toISOString()
const title = (id, name, progress = 0, total = 12, format = 'TV', status = 'watching') => ({
  id: String(id), anilistId: id, title: name, progress, episodesTotal: total, format, status,
  addedAt: now, updatedAt: now, lastWatchedAt: now, detailsLoaded: true, episodeListLoaded: true,
  coverImage: '/art/rooftop.png', bannerImage: '/art/duality.png', genres: ['Adventure'],
  notes: '', rating: null, rewatchStatus: 'none', episodeList: [],
})
const ledger = { library: [
  title(21, 'One Piece', 754, null), title(153518, 'Delicious in Dungeon', 8, 24),
  title(171018, 'DAN DA DAN', 3), title(21519, 'Your Name.', 0, 1, 'MOVIE', 'planning'),
  title(1, 'Cowboy Bebop', 26, 26, 'TV', 'completed'), title(20954, 'A Silent Voice', 1, 1, 'MOVIE', 'completed'),
  title(1535, 'The Very Long Title of a Show That Needs to Fit Gracefully in the Player Header', 2),
], history: [] }
const storage = (data = ledger) => ({ cookies: [], origins: [{ origin: base, localStorage: [{ name: 'gptnime-tracker-library-v1', value: JSON.stringify(data) }] }] })
const errors = []
// Real loopback HTTP delivery that can hold a response open, keeping a video loading.
let mediaGate = Promise.resolve()
let releaseMedia = () => {}
const holdMedia = () => { mediaGate = new Promise((resolve) => { releaseMedia = resolve }) }
const mediaServer = createHttpServer(async (request, response) => {
  if (!request.url?.startsWith('/slow.webm')) { response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('Missing media fixture'); return }
  const body = await readFile('tests/fixtures/cinema-test.webm')
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '')
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
  // Send successful headers at once, as a CDN does, and hold only the video bytes.
  response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/webm', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) })
  response.flushHeaders()
  await mediaGate
  if (!response.destroyed) response.end(body.subarray(start, end + 1))
})
await new Promise((resolve) => mediaServer.listen(0, '127.0.0.1', resolve))
const mediaBase = `http://127.0.0.1:${mediaServer.address().port}`

try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: process.env.CINEMA_HEADED !== '1', args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, storageState: storage() })
  await context.route('**/api/wco/prefetch', route => route.fulfill({ json: { ready: false, expiresAt: 0 } }))
  await context.route('**/api/wco/status', (route) => route.fulfill({ json: { available: false } }))
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: { recommendations: { nodes: [] } } } } }))
  const providerRequests = []
  await context.route('https://www.wco.tv/**', async (route) => {
    providerRequests.push({ method: route.request().method(), url: route.request().url(), data: route.request().postData() })
    await route.fulfill({ contentType: 'text/html', body: '<h1>WCO route contract fixture</h1>' })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base)
  await page.locator('.anime-tv-fab').click()
  const dialog = page.getByRole('dialog', { name: 'GPTNime cinema' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.locator('#root').evaluate((root) => root.inert), true)
  assert.equal(await page.getByLabel('Cinema episode number').inputValue(), '755')
  assert.equal(await page.locator('.cinema-queue-row').count(), 7)
  await page.screenshot({ path: `${output}/01-cinema-desktop.png`, fullPage: false })
  passed('Cinema opens with the next episode and includes completed titles and movies')

  await page.getByText('Source options', { exact: true }).click()
  const popupPromise = page.waitForEvent('popup')
  await page.locator('.cinema-search-form').getByRole('button', { name: 'Find on WCO' }).click()
  const provider = await popupPromise
  await provider.waitForURL('https://www.wco.tv/search')
  assert.equal(await provider.evaluate(() => window.opener), null)
  assert.equal(providerRequests[0].method, 'POST')
  const posted = new URLSearchParams(providerRequests[0].data)
  assert.equal(posted.get('konuara'), 'episodes')
  assert.equal(posted.get('catara'), 'One Piece episode 755 english subbed')
  assert.equal(await dialog.locator('iframe').count(), 0)
  await provider.close()
  passed('WCO search uses the observed POST route in an isolated provider window')

  await page.getByText('Save a WCO page', { exact: true }).click()
  await page.getByLabel('WCO page URL', { exact: true }).fill('https://www.wco.tv.evil.example/one-piece')
  await page.getByRole('button', { name: 'Save page', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Use a WCO' }).waitFor()
  await page.getByLabel('WCO page URL', { exact: true }).fill('https://www.wco.tv/one-piece-episode-755-english-subbed')
  await page.getByRole('button', { name: 'Save page', exact: true }).click()
  await page.getByRole('button', { name: 'Open saved episode', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dubbed', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Open saved episode', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Subbed', exact: true }).click()
  await page.getByRole('button', { name: 'Open saved episode', exact: true }).waitFor()
  passed('Saved WCO pages validate domains and stay scoped to episode and language')

  await page.getByRole('button', { name: 'Your files Play in cinema' }).click()
  await page.getByLabel('Choose local video', { exact: true }).setInputFiles('tests/fixtures/cinema-test.webm')
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await page.locator('video').evaluate((video) => { video.muted = true; video.currentTime = 11.2 })
  await page.waitForTimeout(350)
  const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library.find((item) => item.id === '21').progress)
  assert.equal(await progress(), 754)
  await page.getByRole('button', { name: 'Restart current video' }).click()
  await page.locator('video').evaluate(async (video) => { video.dataset.identity = 'same-video'; await video.play() })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Dock mini-player' }).click()
  assert.equal(await page.locator('#root').evaluate((root) => root.inert), false)
  assert.equal(await page.locator('video').getAttribute('data-identity'), 'same-video')
  assert.equal(await page.locator('video').evaluate((video) => video.paused), false)
  await page.screenshot({ path: `${output}/02-cinema-docked.png` })
  await page.getByRole('button', { name: 'Expand cinema' }).click()
  assert.equal(await page.locator('video').getAttribute('data-identity'), 'same-video')
  passed('Seeking does not mark watched; docking preserves the live video and releases the page')

  // Force the cross-browser window fallback so it is tested independently of native PiP.
  await page.locator('video').evaluate((video) => { video.currentTime = 4; video.pause() })
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 4)
  await page.evaluate(() => Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }))
  const playerPopupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Pop out player' }).click()
  const playerPopup = await playerPopupPromise
  await playerPopup.locator('video').waitFor()
  await playerPopup.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video').dataset.cinemaMoving)
  assert.equal(await playerPopup.locator('video').getAttribute('data-identity'), 'same-video')
  assert.ok(Math.abs(await playerPopup.locator('video').evaluate((video) => video.currentTime) - 4) < .2)
  assert.equal(await playerPopup.locator('video').evaluate((video) => video.paused), true)
  assert.equal(await page.locator('video').count(), 0)
  await playerPopup.screenshot({ path: `${output}/03-cinema-popout.png` })
  await playerPopup.getByRole('button', { name: 'Pop player back in' }).click()
  await page.locator('video').waitFor()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video').dataset.cinemaMoving)
  assert.equal(await page.locator('video').getAttribute('data-identity'), 'same-video')
  assert.ok(Math.abs(await page.locator('video').evaluate((video) => video.currentTime) - 4) < .2)
  await page.locator('video').evaluate((video) => video.pause())
  passed('Pop out and pop in move the same video element with working controls')

  await page.getByRole('button', { name: 'Restart current video' }).click()
  await page.getByLabel('Playback speed').selectOption('2')
  await page.locator('video').evaluate((video) => video.play())
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library.find((item) => item.id === '21').progress === 755, null, { timeout: 15000 })
  await page.waitForFunction(() => document.querySelector('video')?.ended)
  assert.equal(await page.getByLabel('Cinema episode number').inputValue(), '755')
  const progressEvents = await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).history.filter((item) => item.type === 'progress'))
  assert.equal(progressEvents.length, 1)
  await page.getByRole('button', { name: 'Next episode in cinema' }).click()
  assert.equal(await page.getByLabel('Cinema episode number').inputValue(), '756')
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Open saved episode', exact: true }).count(), 0)
  passed('90% of actual playback marks once; advancing clears the old media and episode link')

  await page.getByRole('button', { name: 'Your files Play in cinema' }).click()
  await page.getByLabel('Choose local video', { exact: true }).setInputFiles('tests/fixtures/cinema-test.webm')
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await page.locator('video').evaluate((video) => { video.currentTime = 4 })
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Clear source' }).click()
  await page.getByLabel('Choose local video', { exact: true }).setInputFiles('tests/fixtures/cinema-test.webm')
  await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 3.9)
  assert.equal(await page.locator('video').evaluate((video) => video.paused), true)
  passed('Resume points survive reselecting a file without autoplay')

  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'episode.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:09.000\nCinema subtitle fixture\n') })
  await page.waitForFunction(() => document.querySelector('video').textTracks.length === 1)
  assert.equal(await page.locator('track').getAttribute('kind'), 'subtitles')
  await page.getByRole('button', { name: 'Clear source' }).click()
  await page.getByRole('button', { name: 'Video URL Play in cinema' }).click()
  await page.getByLabel('Direct video URL', { exact: true }).fill('https://www.wco.tv/some-show')
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'direct HTTPS video URL' }).waitFor()
  const bytes = await readFile('tests/fixtures/cinema-test.webm')
  await context.route('https://media.example.test/episode.webm', (route) => route.fulfill({ contentType: 'video/webm', body: bytes }))
  await page.getByLabel('Direct video URL', { exact: true }).fill('https://media.example.test/episode.webm')
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.equal(await page.locator('video').getAttribute('src'), 'https://media.example.test/episode.webm')
  const stored = await page.evaluate(() => localStorage.getItem('gptnime-cinema-v1'))
  assert.ok(!stored.includes('media.example.test'))
  passed('VTT subtitles and direct video URLs load; media URLs are not persisted')

  // A provider's iframe policy is not a blanket ban on that provider's media host.
  // This is a routing fixture, not evidence of successful live WCO playback.
  const providerMediaUrl = 'https://u44.wcostream.com/getvid?evid=cinema-test-fixture'
  const mediaReferrers = []
  await context.route(providerMediaUrl, async (route) => {
    const referer = (await route.request().allHeaders()).referer
    mediaReferrers.push(referer)
    await route.fulfill(referer
      ? { status: 404, contentType: 'text/html', body: 'Referrer-sensitive media fixture' }
      : { contentType: 'video/webm', body: bytes })
  })
  await page.getByLabel('Direct video URL', { exact: true }).fill(providerMediaUrl)
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.equal(await page.locator('video').getAttribute('src'), providerMediaUrl)
  assert.ok(mediaReferrers.length > 0)
  assert.ok(mediaReferrers.every((referer) => referer === undefined))
  // Use real HTTP delivery across documents. Chromium can leave a media load
  // pending when an element backed by a fulfilled DevTools response is adopted.
  const popupMediaUrl = `${base}/tests/fixtures/cinema-test.webm`
  const popupReferrers = []
  await context.unrouteAll({ behavior: 'wait' })
  context.on('request', (request) => {
    if (request.url() === popupMediaUrl) popupReferrers.push(request.headers().referer || null)
  })
  await page.getByLabel('Direct video URL', { exact: true }).fill(popupMediaUrl)
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  const sourcePopupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Pop out player' }).click()
  const sourcePopup = await sourcePopupPromise
  await sourcePopup.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.equal(await sourcePopup.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer')
  await sourcePopup.locator('video').evaluate((video) => video.load())
  await sourcePopup.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.ok(popupReferrers.length >= 2)
  assert.ok(popupReferrers.every((referer) => referer === null))
  await sourcePopup.getByRole('button', { name: 'Pop player back in' }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  // Float uses the browser's own frameless video Picture-in-Picture; the video stays in the page.
  await page.evaluate(() => {
    const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
    window.sessionHandlers = {}
    navigator.mediaSession.setActionHandler = (action, handler) => { window.sessionHandlers[action] = handler; original(action, handler) }
  })
  await page.locator('video').evaluate((video) => { video.dataset.identity = 'float-video'; video.currentTime = 6 })
  await page.getByRole('button', { name: 'Dock mini-player' }).click()
  assert.equal(await page.evaluate(() => typeof window.sessionHandlers.enterpictureinpicture), 'function')
  assert.equal(await page.evaluate(() => navigator.mediaSession.metadata?.artist), 'GPTNime')
  await page.getByRole('button', { name: 'Float video on top' }).click()
  await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('video'))
  assert.equal(await page.getByRole('button', { name: 'Return floating video' }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('video').getAttribute('data-identity'), 'float-video')
  assert.equal(await page.locator('.cinema-overlay').getAttribute('class'), 'cinema-overlay cinema-layout-dock is-floating')
  await page.getByRole('button', { name: 'Return floating video' }).click()
  await page.waitForFunction(() => !document.pictureInPictureElement)
  await page.getByRole('button', { name: 'Float video on top' }).waitFor()
  // Automatic Picture-in-Picture calls the media-session action when the tab is hidden.
  await page.evaluate(() => window.sessionHandlers.enterpictureinpicture())
  await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('video'))
  await page.getByRole('button', { name: 'Return floating video' }).waitFor()
  await page.evaluate(() => document.exitPictureInPicture())
  await page.getByRole('button', { name: 'Float video on top' }).waitFor()
  assert.ok(Math.abs(await page.locator('video').evaluate((video) => video.currentTime) - 6) < .3)
  // Chrome keeps a removed video in the float, so a replacement (as with Sub/Dub) must take it over.
  await page.getByRole('button', { name: 'Float video on top' }).click()
  await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('video'))
  assert.match(await page.locator('.cinema-overlay').getAttribute('class'), /is-floating/)
  assert.ok(await page.locator('.cinema-screen').evaluate((node) => node.getBoundingClientRect().height) < 60)
  await page.getByRole('button', { name: 'Expand cinema' }).click()
  await page.getByLabel('Direct video URL', { exact: true }).fill(`${base}/tests/fixtures/version-test.webm`)
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.currentSrc.endsWith('version-test.webm') && document.pictureInPictureElement === document.querySelector('video'))
  await page.getByRole('button', { name: 'Dock mini-player' }).click()
  await page.getByRole('button', { name: 'Return floating video' }).click()
  await page.waitForFunction(() => !document.pictureInPictureElement)
  await page.getByRole('button', { name: 'Expand cinema' }).click()
  passed('The mini-player video floats on top in the browser window, follows a replacement video and returns, by button or automatically')
  await page.locator('video').evaluate((video) => { video.currentTime = 4 })
  await page.getByRole('button', { name: 'Clear source' }).click()
  await context.route('**/api/wco/status', (route) => route.fulfill({ json: { available: false } }))
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: { recommendations: { nodes: [] } } } } }))
  assert.ok(!(await page.evaluate(() => localStorage.getItem('gptnime-cinema-v1'))).includes('cinema-test-fixture'))
  passed('Direct media is not rejected solely for a WCO CDN hostname; references stay session-only')

  // Seed a resume point, then pop out while the same source is still loading.
  // Playwright request interception itself stalls a video adopted mid-download,
  // so routes are lifted here, as in the previous real-delivery check.
  await context.unrouteAll({ behavior: 'wait' })
  const slowMediaUrl = `${mediaBase}/slow.webm`
  await page.getByLabel('Direct video URL', { exact: true }).fill(slowMediaUrl)
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await page.locator('video').evaluate((video) => { video.currentTime = 6 })
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 6) < .05)
  await page.getByRole('button', { name: 'Clear source' }).click()
  // A separate URL avoids Chromium's media cache; give it the same saved point.
  const heldMediaUrl = `${slowMediaUrl}?held`
  await page.evaluate(([from, to]) => {
    const fingerprint = (value) => { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(36) }
    const state = JSON.parse(localStorage.getItem('gptnime-cinema-v1'))
    const [key, bookmark] = Object.entries(state.bookmarks).find(([key]) => key.endsWith(`:${fingerprint(from)}`))
    state.bookmarks[key.replace(/[^:]+$/, fingerprint(to))] = bookmark
    localStorage.setItem('gptnime-cinema-v1', JSON.stringify(state))
  }, [slowMediaUrl, heldMediaUrl])
  holdMedia()
  await page.getByLabel('Direct video URL', { exact: true }).fill(heldMediaUrl)
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState === 0)
  const loadingPopupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Pop out player' }).click()
  const loadingPopup = await loadingPopupPromise
  await loadingPopup.locator('video').waitFor()
  assert.equal(await loadingPopup.locator('video').evaluate((video) => video.dataset.cinemaMoving), undefined)
  releaseMedia()
  await loadingPopup.waitForFunction(() => document.querySelector('video')?.readyState >= 1 && Math.abs(document.querySelector('video').currentTime - 6) < .2)
  await loadingPopup.getByRole('button', { name: 'Pop player back in' }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1 && !document.querySelector('video').dataset.cinemaMoving)
  assert.ok(Math.abs(await page.locator('video').evaluate((video) => video.currentTime) - 6) < .2)
  await page.getByRole('button', { name: 'Clear source' }).click()
  // A failed source has no position to transfer and must not stay marked as moving.
  await page.getByLabel('Direct video URL', { exact: true }).fill(`${mediaBase}/missing.webm`)
  await page.getByRole('button', { name: 'Load video', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.error)
  const failedPopupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Pop out player' }).click()
  const failedPopup = await failedPopupPromise
  await failedPopup.locator('video').waitFor()
  assert.equal(await failedPopup.locator('video').evaluate((video) => video.dataset.cinemaMoving), undefined)
  await failedPopup.getByRole('button', { name: 'Pop player back in' }).click()
  await page.locator('video').waitFor()
  assert.equal(await page.locator('video').evaluate((video) => video.dataset.cinemaMoving), undefined)
  await page.getByRole('button', { name: 'Clear source' }).click()
  await context.route('**/api/wco/status', (route) => route.fulfill({ json: { available: false } }))
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: { recommendations: { nodes: [] } } } } }))
  passed('Pop-out during loading keeps the resume point; failed media never stays marked as moving')

  await page.getByRole('button', { name: 'Close cinema', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.locator('.anime-card').first().waitFor()
  const clippedActions = await page.locator('.anime-card').evaluateAll((cards) => cards.some((card) => {
    const bounds = card.getBoundingClientRect()
    return Array.from(card.querySelectorAll('.card-actions button, .rating-glint')).some((action) => action.getBoundingClientRect().right > bounds.right)
  }))
  assert.equal(clippedActions, false)
  await page.getByRole('button', { name: 'Watch Your Name.', exact: true }).click()
  await page.getByText('Feature film', { exact: true }).first().waitFor()
  assert.equal(await page.getByRole('button', { name: 'Next episode in cinema' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Mark movie watched' }).click()
  assert.equal(await page.locator('.cinema-mark').innerText(), 'Watched')
  assert.equal(await page.getByRole('dialog').count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Close cinema' }).isVisible(), true)
  passed('Movie Watch actions complete one feature without opening a competing modal')

  await page.keyboard.press('Escape')
  await page.locator('.cinema-layout-dock').waitFor()
  await page.getByRole('button', { name: 'Expand cinema' }).click()
  await page.getByRole('button', { name: 'Close cinema' }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.querySelector('.cinema-portal').contains(document.activeElement)), true)
  await page.getByRole('button', { name: 'Close cinema' }).click()
  assert.equal(await page.locator('#root').evaluate((root) => root.inert), false)
  passed('Escape docks, keyboard focus stays in cinema, and close restores page interaction')

  await page.getByRole('button', { name: 'Open focused anime view' }).click()
  await page.locator('.focus-modal').getByRole('button', { name: 'Watch', exact: true }).click()
  await page.waitForSelector('.focus-modal', { state: 'detached' })
  assert.equal(await page.locator('.watch-cinema').count(), 1)
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden')
  await page.getByRole('button', { name: 'Close cinema' }).click()
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden')
  await page.locator('.anime-card').filter({ hasText: 'Delicious in Dungeon' }).locator('.cover-button').click()
  await page.locator('.detail-panel .episode-row').nth(1).click()
  assert.equal(await page.getByLabel('Cinema episode number').inputValue(), '2')
  await page.getByRole('button', { name: 'Close cinema' }).click()
  passed('Focused details and episode rows open cinema without competing scroll locks')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.anime-tv-fab').click()
  await page.getByRole('button', { name: 'WCO Provider window' }).click()
  await page.screenshot({ path: `${output}/04-cinema-mobile.png` })
  const dimensions = await page.locator('.watch-cinema').evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, page: innerWidth }))
  assert.ok(dimensions.scroll <= dimensions.width + 1)
  assert.ok(dimensions.width <= dimensions.page)
  await page.getByRole('button', { name: 'Dock mini-player' }).click()
  await page.screenshot({ path: `${output}/05-cinema-mobile-docked.png` })
  passed('390px mobile cinema and dock fit the viewport')
  await page.getByRole('button', { name: 'Close cinema' }).click()

  // AniSkip times are matched to this copy's length (version-test.webm runs 120 s).
  const skipContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: storage({ library: [{ ...title(205, 'Samurai Champloo', 2, 26), idMal: 205 }], history: [] }) })
  await skipContext.route('**/api/wco/prefetch', (route) => route.fulfill({ json: { ready: false, expiresAt: 0 } }))
  await skipContext.route('**/api/wco/status', (route) => route.fulfill({ json: { available: false } }))
  await skipContext.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: { recommendations: { nodes: [] } } } } }))
  const skipRequests = []
  await skipContext.route('https://api.aniskip.com/**', (route) => {
    skipRequests.push(route.request().url())
    route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { found: true, statusCode: 200, results: [
      { interval: { startTime: 30, endTime: 60 }, skipType: 'op', skipId: 'other-cut', episodeLength: 150 },
      { interval: { startTime: 0, endTime: 20 }, skipType: 'op', skipId: 'opening', episodeLength: 119.4 },
      { interval: { startTime: 100, endTime: 121 }, skipType: 'ed', skipId: 'ending', episodeLength: 121 },
    ] } })
  })
  const skipPage = await skipContext.newPage()
  skipPage.on('pageerror', (error) => errors.push(error.message))
  await skipPage.goto(base)
  const segments = await skipPage.evaluate(async () => (await import('/src/watch/skipTimes.ts')).skipSegments([
    { interval: { startTime: 0, endTime: 90 }, skipType: 'op', episodeLength: 1400 },
    { interval: { startTime: 1300, endTime: 1390 }, skipType: 'ed', episodeLength: 1400 },
    { interval: { startTime: 1310, endTime: 1400 }, skipType: 'mixed-ed', episodeLength: 1395 },
    { interval: { startTime: 600, endTime: 602 }, skipType: 'recap', episodeLength: 1405 },
    { interval: { startTime: 'x', endTime: 9 }, skipType: 'op', episodeLength: 1405 },
  ], 1405))
  assert.deepEqual(segments, [{ kind: 'opening', start: 0, end: 90 }, { kind: 'ending', start: 1305, end: 1395 }], 'Closest-length times win; endings follow the length difference; tiny and malformed sections are ignored')
  await skipPage.locator('.anime-tv-fab').click()
  await skipPage.getByRole('button', { name: 'Your files Play in cinema' }).click()
  await skipPage.getByLabel('Choose local video', { exact: true }).setInputFiles('tests/fixtures/version-test.webm')
  await skipPage.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await skipPage.locator('video').evaluate((video) => { video.muted = true })
  const skipOpening = skipPage.getByRole('button', { name: 'Skip opening' })
  await skipOpening.waitFor()
  assert.match(skipRequests[0], /\/v2\/skip-times\/205\/3\?/)
  await skipPage.screenshot({ path: `${output}/12-skip-opening.png` })
  await skipOpening.click()
  assert.ok(Math.abs(await skipPage.locator('video').evaluate((video) => video.currentTime) - 20) < .3)
  await skipOpening.waitFor({ state: 'detached' })
  // Watch the middle quickly; the skipped opening and ending count toward the 90% mark.
  await skipPage.locator('video').evaluate((video) => { video.playbackRate = 16; return video.play() })
  await skipPage.waitForFunction(() => document.querySelector('video').currentTime >= 99.4, null, { timeout: 15000 })
  await skipPage.locator('video').evaluate((video) => video.pause())
  await skipPage.getByRole('button', { name: 'Skip ending' }).waitFor()
  assert.equal(await skipPage.getByRole('button', { name: 'Skip opening' }).count(), 0)
  await skipPage.getByLabel('Cinema episode number').focus()
  await skipPage.keyboard.press('s')
  assert.equal(await skipPage.locator('video').evaluate((video) => video.currentTime < 100), true, 'S in a text field types instead of skipping')
  await skipPage.locator('video').focus()
  await skipPage.keyboard.press('s')
  await skipPage.waitForFunction(() => document.querySelector('video').ended)
  await skipPage.waitForFunction(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library[0].progress === 3)
  await skipPage.getByText('Ready for the next episode?').waitFor()
  passed('Skip opening/ending follows AniSkip times matched to this copy, works by button or S, and skipped sections still count as watched')
  await skipPage.getByRole('button', { name: 'Restart current video' }).click()
  await skipOpening.waitFor()
  await skipPage.locator('video').dblclick()
  const fullscreen = await skipPage.waitForFunction(() => document.fullscreenElement?.className, null, { timeout: 5000 }).then((handle) => handle.jsonValue(), () => null)
  if (fullscreen) {
    assert.match(fullscreen, /cinema-screen/, 'Fullscreen shows the player frame, keeping Skip on screen')
    assert.equal(await skipOpening.isVisible(), true)
    await skipPage.screenshot({ path: `${output}/13-skip-fullscreen.png` })
    // Real pointer input reaches the video's own controls, and Skip works in fullscreen.
    assert.equal(await skipPage.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.tagName), 'VIDEO')
    await skipPage.mouse.click(24, (await skipPage.evaluate(() => innerHeight)) - 48)
    await skipPage.waitForFunction(() => !document.querySelector('video').paused)
    await skipOpening.click()
    assert.ok(await skipPage.locator('video').evaluate((video) => video.currentTime >= 20))
    assert.match(await skipPage.evaluate(() => document.fullscreenElement?.className), /cinema-screen/)
    await skipPage.mouse.dblclick(640, 400)
    await skipPage.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 })
    await skipPage.locator('video').dblclick()
    await skipPage.waitForFunction(() => document.fullscreenElement?.classList.contains('cinema-screen'), null, { timeout: 5000 })
    await skipPage.waitForTimeout(300)
    const size = await skipPage.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await skipPage.mouse.move(size.width / 2, size.height - 48)
    await skipPage.mouse.click(size.width - 72, size.height - 48)
    await skipPage.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 })
    passed('Video fullscreen hands over to the player frame: Skip stays visible, the video controls work, and double-click or the fullscreen control leaves it')
  } else process.stdout.write('- Fullscreen is unavailable in this browser mode; run with CINEMA_HEADED=1\n')
  await skipContext.close()

  // Native Document PiP needs a desktop window. Run this section with CINEMA_HEADED=1.
  if (process.env.CINEMA_HEADED === '1') {
    const nativePage = await context.newPage()
    nativePage.on('pageerror', (error) => errors.push(error.message))
    await nativePage.goto(base)
    await nativePage.locator('.anime-tv-fab').click()
    await nativePage.getByRole('button', { name: 'Your files Play in cinema' }).click()
    await nativePage.getByLabel('Choose local video', { exact: true }).setInputFiles('tests/fixtures/cinema-test.webm')
    await nativePage.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
    await nativePage.locator('video').evaluate((video) => { video.muted = true; video.currentTime = 4; video.dataset.identity = 'native-pip-video' })
    await nativePage.waitForTimeout(200)
    assert.equal(await nativePage.evaluate(() => Boolean(window.documentPictureInPicture)), true)
    await nativePage.getByRole('button', { name: 'Pop out player' }).click()
    await nativePage.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector('video')?.readyState >= 2)
    const snapshot = await nativePage.evaluate(() => {
      const video = window.documentPictureInPicture.window.document.querySelector('video')
      return { time: video.currentTime, paused: video.paused, identity: video.dataset.identity }
    })
    assert.equal(snapshot.identity, 'native-pip-video')
    assert.ok(Math.abs(snapshot.time - 4) < .2)
    assert.equal(snapshot.paused, true)
    await nativePage.evaluate(() => window.documentPictureInPicture.window.close())
    await nativePage.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video')?.dataset.cinemaMoving)
    assert.ok(Math.abs(await nativePage.locator('video').evaluate((video) => video.currentTime) - 4) < .2)
    await nativePage.getByLabel('Playback speed').selectOption('1.5')
    await nativePage.locator('video').evaluate((video) => video.play())
    await nativePage.waitForTimeout(300)
    const before = await nativePage.locator('video').evaluate((video) => video.currentTime)
    await nativePage.getByRole('button', { name: 'Pop out player' }).click()
    await nativePage.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector('video')?.readyState >= 2)
    await nativePage.waitForTimeout(300)
    const playing = await nativePage.evaluate(() => {
      const video = window.documentPictureInPicture.window.document.querySelector('video')
      return { time: video.currentTime, paused: video.paused, rate: video.playbackRate }
    })
    assert.equal(playing.paused, false)
    assert.equal(playing.rate, 1.5)
    assert.ok(playing.time >= before)
    await nativePage.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[aria-label="Pop player back in"]').click())
    await nativePage.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video')?.dataset.cinemaMoving)
    await nativePage.getByRole('button', { name: 'Close cinema' }).click()
    await nativePage.close()
    passed('Native Document PiP preserves paused time, active playback and speed; browser close returns the player')
  }
  await context.close()

  const emptyContext = await browser.newContext({ storageState: storage({ library: [], history: [] }) })
  const emptyPage = await emptyContext.newPage()
  await emptyPage.goto(base)
  await emptyPage.locator('.anime-tv-fab').click()
  await emptyPage.getByText('Your cinema starts here', { exact: true }).waitFor()
  await emptyPage.getByRole('button', { name: 'Back to gptNime' }).click()
  assert.equal(await emptyPage.locator('.watch-cinema').count(), 0)
  await emptyContext.close()
  assert.deepEqual(errors, [])
  passed('Empty libraries remain usable; no browser runtime errors')
  await writeFile(`${output}/verification.json`, JSON.stringify({ time: new Date().toISOString(), results, errors, provider: 'WCO requests are intercepted fixtures; this suite does not claim live WCO playback.' }, null, 2))
} finally {
  await browser?.close()
  server?.kill()
  mediaServer.close()
}
