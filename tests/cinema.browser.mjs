import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
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

try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: process.env.CINEMA_HEADED !== '1', args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, storageState: storage() })
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
  await page.locator('video').evaluate((video) => { video.currentTime = 4 })
  await page.getByRole('button', { name: 'Clear source' }).click()
  await context.route('**/api/wco/status', (route) => route.fulfill({ json: { available: false } }))
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: { recommendations: { nodes: [] } } } } }))
  assert.ok(!(await page.evaluate(() => localStorage.getItem('gptnime-cinema-v1'))).includes('cinema-test-fixture'))
  passed('Direct media is not rejected solely for a WCO CDN hostname; references stay session-only')

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
}
