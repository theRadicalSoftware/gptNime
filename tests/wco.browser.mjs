import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const base = 'http://127.0.0.1:5198'
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } })
await server.listen()
let browser
try {
  const { episodePage, videoSource, matchingEpisodes, selectionError, episodeLinks } = await server.ssrLoadModule('/server/wco.ts')
  const series = 'https://www.wco.tv/anime/cowboy-bebop/?season=all'
  const episode = 'https://www.wco.tv/cowboy-bebop-episode-25-english-dubbed-2'
  assert.equal(episodePage(series), series)
  assert.equal(episodePage(episode), episode)
  for (const invalid of ['http://www.wco.tv/anime/test', 'https://www.wco.tv.evil.test/episode', 'https://user@www.wco.tv/episode', 'https://127.0.0.1/episode', 'https://www.wco.tv/inc/embed/index.php', 'https://www.wco.tv/episode?token=secret', 'https://www.wco.tv/wp-admin/admin.php']) {
    assert.equal(episodePage(invalid), null)
  }
  assert.equal(videoSource('https://undisk4.wcostream.com/getvid?evid=fixture'), true)
  assert.equal(videoSource('https://undisk4.wcostream.com.evil.test/getvid?evid=fixture'), false)
  assert.equal(videoSource('https://undisk4.wcostream.com/getvid?evid='), false)
  const links = [
    { title: 'Episode 25 English Dubbed', url: episode },
    { title: 'Episode 25 English Dubbed', url: episode },
    { title: 'Episode 250 English Dubbed', url: 'https://www.wco.tv/test-episode-250-english-dubbed' },
    { title: 'Episode 25 English Subbed', url: 'https://www.wco.tv/test-episode-25-english-subbed' },
  ]
  assert.deepEqual(matchingEpisodes(links, 25, 'dub'), [episode])
  console.log('✓ Provider validation excludes unrelated hosts, credentials, transient pages and wrong episodes')

  const request = { url: episode, episode: 25, language: 'dub', movie: false }
  assert.equal(selectionError('Cowboy Bebop: Episode 25 English Dubbed', request), null)
  assert.match(selectionError('Cowboy Bebop: Episode 26 English Dubbed', request), /episode 26/)
  assert.match(selectionError('Cowboy Bebop: Episode 25 English Subbed', request), /Choose Subbed/)
  assert.match(selectionError('Cowboy Bebop: Episode 25 English Dubbed', { ...request, movie: true }), /movie’s exact/)
  const post = (body, headers = {}) => fetch(`${base}/api/wco/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body),
  })
  assert.equal((await post(request, { Origin: 'https://unrelated.example' })).status, 403)
  assert.equal((await post(request, { Host: 'unrelated.example', Origin: 'http://unrelated.example' })).status, 403)
  assert.equal((await post({ ...request, url: 'http://127.0.0.1/private' })).status, 400)
  assert.equal((await post({ ...request, episode: 0 })).status, 400)
  assert.equal((await post({ ...request, padding: 'x'.repeat(5000) })).status, 400)
  assert.equal((await fetch(`${base}/api/wco/resolve`)).status, 405)
  console.log('✓ Local API rejects foreign origins, DNS rebinding hosts and invalid requests before opening a browser')

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--mute-audio'] })
  const context = await browser.newContext()
  const now = new Date().toISOString()
  const ledger = { library: [{ id: '1', anilistId: 1, title: 'Cowboy Bebop', progress: 24, episodesTotal: 26, format: 'TV', status: 'watching', addedAt: now, updatedAt: now, detailsLoaded: true, episodeListLoaded: true, episodeList: [], genres: [], notes: '', rewatchStatus: 'none' }], history: [] }
  await context.addInitScript((data) => {
    if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify(data))
  }, ledger)
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: null } } }))
  await context.route('**/api/wco/status', (route) => route.fulfill({ json: { available: true } }))
  const source = 'https://undisk4.wcostream.com/getvid?evid=private-fixture'
  const bytes = await readFile('tests/fixtures/cinema-test.webm')
  await context.route(source, async (route) => {
    assert.equal((await route.request().allHeaders()).referer, undefined)
    await route.fulfill({ contentType: 'video/webm', body: bytes })
  })
  let pending
  const requests = []
  await context.route('**/api/wco/resolve', async (route) => {
    requests.push(route.request().postDataJSON())
    assert.equal((await route.request().allHeaders()).origin, base)
    pending = route
  })
  const page = await context.newPage()
  await page.setContent(`<aside><a href="https://www.wco.tv/wrong-show-episode-25-english-dubbed">Episode 25 English Dubbed</a></aside><div id="episodeList"><a href="${episode}">Episode 25 English Dubbed</a></div><span class="prev-next"><a href="${episode}">Episode 25 English Dubbed</a></span>`)
  assert.deepEqual(matchingEpisodes(await episodeLinks(page, true), 25, 'dub'), [episode])
  assert.deepEqual(matchingEpisodes(await episodeLinks(page, false), 25, 'dub'), [episode])
  console.log('✓ Episode discovery excludes unrelated shows in recent-release sidebars')
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base)
  await page.locator('.anime-tv-fab').click()
  await page.getByRole('button', { name: 'WCO Play in cinema', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dubbed', exact: true }).click()
  await page.getByLabel('WCO playback URL', { exact: true }).fill(series)
  await page.getByRole('button', { name: 'Play here', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor()
  await page.waitForTimeout(150)
  assert.deepEqual(requests[0], { ...request, url: series })
  await pending.fulfill({ json: { source, pageUrl: episode, title: 'Cowboy Bebop: Episode 25 English Dubbed', previousPage: 'https://www.wco.tv/cowboy-bebop-episode-24-english-dubbed-2', nextPage: 'https://www.wco.tv/cowboy-bebop-episode-26-english-dubbed-2' } })
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.equal(await page.locator('video').evaluate((video) => video.paused), true)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-cinema-v1')))
  assert.equal(saved.pages['1:title:dub'], series)
  assert.equal(saved.pages['1:25:dub'], episode)
  assert.ok(saved.pages['1:26:dub'])
  assert.ok(!JSON.stringify(saved).includes('private-fixture'))
  console.log('✓ Series preparation loads actual fixture video, saves episode neighbors and keeps media references out of storage')

  await page.getByRole('button', { name: 'Next episode in cinema' }).click()
  await page.getByRole('button', { name: 'WCO Play in cinema', exact: true }).waitFor()
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await page.getByLabel('WCO playback URL', { exact: true }).inputValue(), saved.pages['1:26:dub'])
  await page.getByRole('button', { name: 'Play here', exact: true }).click()
  await page.waitForTimeout(150)
  const cancelled = pending
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await cancelled.fulfill({ json: { source, pageUrl: saved.pages['1:26:dub'], title: 'Cancelled source' } }).catch(() => {})
  await page.waitForTimeout(150)
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 0)
  assert.equal(await page.getByLabel('WCO playback URL', { exact: true }).isEnabled(), true)
  console.log('✓ Next episode uses its saved link and cancellation prevents a late response from loading video')

  await page.getByRole('button', { name: 'Play here', exact: true }).click()
  await page.waitForTimeout(150)
  await pending.fulfill({ status: 502, json: { error: 'That page is for episode 25. Select that episode in the cinema or use a matching link.' } })
  await page.getByRole('alert').filter({ hasText: 'That page is for episode 25' }).waitFor()
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library[0].progress), 24)
  assert.deepEqual(errors, [])
  console.log('✓ Preparation errors remain actionable and leave ledger progress unchanged')
  await page.setViewportSize({ width: 390, height: 844 })
  const dimensions = await page.locator('.watch-cinema').evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, viewport: innerWidth }))
  assert.ok(dimensions.scroll <= dimensions.width + 1 && dimensions.width <= dimensions.viewport)
  await mkdir('output/cinema', { recursive: true })
  await page.screenshot({ path: 'output/cinema/07-wco-mobile.png' })
  console.log('✓ The inline WCO controls fit a 390px mobile viewport')
} finally {
  await browser?.close()
  await server.close()
}
