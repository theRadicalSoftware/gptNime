import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const base = 'http://127.0.0.1:5198'
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } })
await server.listen()
let browser
try {
  const { episodePage, videoSource, matchingEpisodes, selectionError, episodeLinks, titleKey, automaticMatch, searchCandidates, searchLinks, searchEpisodeCandidates, providerAccessMessage, providerBrowser, RecentSources } = await server.ssrLoadModule('/server/wco.ts')
  assert.equal(providerBrowser(undefined), 'chrome')
  assert.equal(providerBrowser('brave'), 'brave')
  assert.equal(providerBrowser('/usr/bin/untrusted'), null)
  assert.match(providerAccessMessage('This Video Is for Premium Users'), /premium accounts/)
  assert.equal(providerAccessMessage('Get PREMIUM Now! Close announcement. Play Video'), null)
  const series = 'https://www.wco.tv/anime/cowboy-bebop/?season=all'
  const episode = 'https://www.wco.tv/cowboy-bebop-episode-25-english-dubbed-2'
  let clock = 0
  const recent = new RecentSources(() => clock)
  const prepared = { kind: 'source', source: 'https://fixture.wcostream.com/getvid?evid=fixture', pageUrl: episode, title: 'Cowboy Bebop Episode 25 English Dubbed', language: 'dub', notice: '', previousPage: null, nextPage: null }
  recent.put(prepared, 25, false)
  assert.equal(recent.get(episode, 25, 'dub', false), prepared)
  assert.equal(recent.get(episode, 25, 'sub', false), undefined)
  assert.equal(recent.get(episode, 26, 'dub', false), undefined)
  assert.equal(recent.get(episode, 25, 'dub', true), undefined)
  assert.equal(new RecentSources().get(episode, 25, 'dub', false), undefined, 'Separate browser caches cannot share a signed source')
  clock = 90_000
  assert.equal(recent.get(episode, 25, 'dub', false), undefined)
  recent.put(prepared, 25, false)
  assert.equal(recent.get(episode, 25, 'dub', false, true), undefined)
  assert.equal(recent.get(episode, 25, 'dub', false), undefined)
  for (let i = 1; i <= 9; i++) recent.put(prepared, i, false)
  assert.equal(recent.get(episode, 1, 'dub', false), undefined)
  assert.equal(recent.get(episode, 9, 'dub', false), prepared)
  console.log('✓ Recent sources expire, stay bounded, distinguish version/episode/movie and are invalidated by explicit refresh')
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
  const candidates = [
    { title: 'Cowboy Bebop', url: series },
    { title: 'Cowboy Bebop English Subbed', url: 'https://www.wco.tv/anime/cowboy-bebop-subbed' },
    { title: 'Cowboy Bebop Season 2', url: 'https://www.wco.tv/anime/cowboy-bebop-season-2' },
  ]
  assert.equal(automaticMatch(candidates, ['Cowboy Bebop'], 'sub', false)?.url, candidates[1].url)
  assert.equal(automaticMatch(candidates, ['Cowboy Bebop'], 'dub', false)?.url, series)
  assert.equal(automaticMatch(candidates, ['Cowboy Bebop Season 3'], 'dub', false), null)
  assert.equal(automaticMatch([...candidates, { title: 'Cowboy Bebop', url: 'https://www.wco.tv/anime/cowboy-bebop-remastered' }], ['Cowboy Bebop'], 'dub', false), null)
  assert.equal(titleKey('Vinland Saga 2nd Season'), titleKey('Vinland Saga Season 2'))
  assert.notEqual(titleKey('Fullmetal Alchemist'), titleKey('Fullmetal Alchemist: Brotherhood'))
  const moviePage = { title: 'Your Name. English Dubbed', url: 'https://www.wco.tv/your-name-english-dubbed' }
  assert.equal(automaticMatch([moviePage, ...links, ...candidates], ['Your Name.'], 'sub', true)?.url, moviePage.url)
  assert.deepEqual(searchCandidates([moviePage, moviePage, ...links, ...candidates], true), [moviePage])
  assert.deepEqual(searchEpisodeCandidates([
    { title: 'Cowboy Bebop: Episode 25 English Dubbed', url: episode },
    { title: 'Cowboy Bebop: Episode 25 English Dubbed', url: episode },
    { title: 'Cowboy Bebop: Episode 250 English Dubbed', url: links[2].url },
    { title: 'Cowboy Bebop Season 2 Episode 25 English Dubbed', url: 'https://www.wco.tv/bebop-season-2-episode-25' },
    { title: 'Wrong Show Episode 25 English Dubbed', url: 'https://www.wco.tv/wrong-show-episode-25' },
  ], ['Cowboy Bebop'], 25), [{ title: 'Cowboy Bebop: Episode 25 English Dubbed', url: episode }])
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
  assert.equal((await post({ ...request, refresh: 'yes' })).status, 400)
  assert.equal((await post({ ...request, padding: 'x'.repeat(5000) })).status, 400)
  assert.equal((await fetch(`${base}/api/wco/resolve`)).status, 405)
  const braveStatus = await (await fetch(`${base}/api/wco/status`, { headers: { 'X-WCO-Browser': 'brave' } })).json()
  assert.equal(braveStatus.browser, 'brave')
  assert.equal((await fetch(`${base}/api/wco/status`, { headers: { 'X-WCO-Browser': 'untrusted' } })).status, 400)
  assert.equal((await fetch(`${base}/api/wco/focus`, { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  assert.equal((await fetch(`${base}/api/wco/focus`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 409)
  console.log('✓ Local API rejects foreign origins, DNS rebinding hosts and invalid requests before opening a browser')

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } })
  const now = new Date().toISOString()
  const ledger = { library: [{ id: '1', anilistId: 1, title: 'Cowboy Bebop', progress: 24, episodesTotal: 26, format: 'TV', status: 'watching', addedAt: now, updatedAt: now, detailsLoaded: true, episodeListLoaded: true, episodeList: [], genres: [], notes: '', rewatchStatus: 'none' }], history: [] }
  await context.addInitScript((data) => {
    // Simulated browser identity for API contract coverage; live Brave is tested separately.
    Object.defineProperty(navigator, 'brave', { value: { isBrave: async () => true } })
    if (!localStorage.getItem('gptnime-cinema-v1')) localStorage.setItem('gptnime-cinema-v1', JSON.stringify({ autoMark: false }))
    if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify(data))
  }, ledger)
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: null } } }))
  let providerStatus = { available: true, hiddenPreparation: true }
  await context.route('**/api/wco/status', (route) => {
    assert.equal(route.request().headers()['x-wco-browser'], 'brave')
    return route.fulfill({ json: providerStatus })
  })
  let focused = 0
  await context.route('**/api/wco/focus', (route) => { assert.equal(route.request().headers()['x-wco-browser'], 'brave'); focused++; return route.fulfill({ json: { shown: true } }) })
  const source = 'https://undisk4.wcostream.com/getvid?evid=private-fixture'
  const bytes = await readFile('tests/fixtures/cinema-test.webm')
  await context.route(source, async (route) => {
    assert.equal((await route.request().allHeaders()).referer, undefined)
    await route.fulfill({ contentType: 'video/webm', body: bytes })
  })
  let pending
  const requests = []
  await context.route('**/api/wco/resolve', async (route) => {
    assert.equal(route.request().headers()['x-wco-browser'], 'brave')
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
  await page.setContent(`<aside><a href="https://www.wco.tv/anime/wrong-show">Wrong show</a></aside><div id="sidebar_right2"><ul class="items"><li><div class="recent-release-episodes"><a href="${series}">Cowboy Bebop</a></div></li></ul></div>`)
  assert.deepEqual(await searchLinks(page), [{ title: 'Cowboy Bebop', url: series }])
  console.log('✓ Title matching preserves seasons/editions, prefers language, distinguishes movies and scopes search results')
  await page.goto(base)
  await page.locator('.anime-tv-fab').click()
  await page.getByRole('button', { name: 'WCO Play in cinema', exact: true }).waitFor()
  await page.waitForTimeout(250)
  assert.equal(requests.length, 0, 'Opening the chooser alone does not start playback')
  assert.equal(await page.getByLabel('WCO playback URL', { exact: true }).isVisible(), false)
  await page.locator('.cinema-queue-row').click()
  await page.waitForFunction(() => !!document.querySelector('.cinema-auto-actions button')?.textContent.includes('Cancel'))
  await page.waitForTimeout(150)
  assert.deepEqual(requests[0], { titles: ['Cowboy Bebop'], episode: 25, language: 'sub', movie: false, choose: false })
  providerStatus = { available: true, requestId: pending.request().headers()['x-wco-request'], phase: 'verification' }
  await page.getByRole('status').filter({ hasText: 'WCO needs verification' }).waitFor()
  await page.getByRole('button', { name: 'Show WCO window', exact: true }).click()
  assert.equal(focused, 1)
  providerStatus = { ...providerStatus, phase: 'preparing' }
  await page.getByRole('status').filter({ hasText: 'Preparing your video' }).waitFor()
  console.log('✓ Verification has a distinct live status and can bring the same WCO window forward')
  await pending.fulfill({ json: { kind: 'source', source, pageUrl: episode, seriesPage: series, language: 'dub', notice: 'WCO has this episode dubbed; using that version.', title: 'Cowboy Bebop: Episode 25 English Dubbed', previousPage: 'https://www.wco.tv/cowboy-bebop-episode-24-english-dubbed-2', nextPage: 'https://www.wco.tv/cowboy-bebop-episode-26-english-dubbed-2' } })
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video && !video.paused && video.currentTime > 0.2 })
  assert.equal(await page.getByRole('button', { name: 'Dubbed', exact: true }).getAttribute('aria-pressed'), 'true')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-cinema-v1')))
  assert.equal(saved.pages['1:title:dub'], series)
  assert.equal(saved.pages['1:25:dub'], episode)
  assert.ok(saved.pages['1:26:dub'])
  assert.ok(!JSON.stringify(saved).includes('private-fixture'))
  console.log('✓ Clicking a title discovers it without any URL, autoplays decoded media and saves stable pages with the actual language')

  await page.locator('video').evaluate((video) => { video.pause(); video.dataset.recentFixture = 'buffered' })
  const previousTime = await page.locator('video').evaluate((video) => video.currentTime)
  await page.locator('.cinema-queue-row').click()
  await page.waitForTimeout(150)
  await pending.fulfill({ json: { kind: 'source', source, pageUrl: episode, language: 'dub', title: 'Cowboy Bebop: Episode 25 English Dubbed' } })
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  assert.equal(await page.locator('video').getAttribute('data-recent-fixture'), 'buffered')
  assert.ok(await page.locator('video').evaluate((video) => video.currentTime) >= previousTime)
  assert.equal(await page.locator('.cinema-loading').count(), 0)
  console.log('✓ Re-selecting a cached episode resumes the same buffered video without waiting for another canplay event')

  const version = page.getByRole('group', { name: 'Episode version', exact: true })
  assert.equal(await page.locator('.cinema-controls').getByRole('group', { name: 'Episode version' }).count(), 1)
  assert.equal(await page.locator('.cinema-source-desk .cinema-language').count(), 0)
  const subSource = `${source}-sub`
  const subPage = 'https://www.wco.tv/cowboy-bebop-episode-25-english-subbed'
  await context.route(subSource, (route) => route.fulfill({ contentType: 'video/webm', body: bytes }))
  await version.getByRole('button', { name: 'Subbed', exact: true }).click()
  await page.waitForTimeout(150)
  assert.equal(requests.at(-1).episode, 25)
  assert.equal(requests.at(-1).language, 'sub')
  assert.equal(requests.at(-1).url, undefined, 'Switching version must not reuse the dubbed page')
  assert.equal(await version.getAttribute('aria-busy'), 'true')
  assert.equal(await page.locator('video').evaluate((video) => video.paused), true)
  await pending.fulfill({ json: { kind: 'source', source: subSource, pageUrl: subPage, language: 'sub', title: 'Cowboy Bebop: Episode 25 English Subbed' } })
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  assert.equal(await version.getByRole('button', { name: 'Subbed', exact: true }).getAttribute('aria-pressed'), 'true')
  await version.getByRole('button', { name: 'Dubbed', exact: true }).click()
  await page.waitForTimeout(150)
  assert.equal(requests.at(-1).url, episode)
  assert.equal(requests.at(-1).language, 'dub')
  await pending.fulfill({ json: { kind: 'source', source, pageUrl: episode, language: 'dub', title: 'Cowboy Bebop: Episode 25 English Dubbed' } })
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  assert.equal(await version.getAttribute('aria-busy'), 'false')
  await mkdir('output/cinema', { recursive: true })
  await page.locator('.cinema-workspace').evaluate((node) => { node.scrollTop = 0 })
  await page.screenshot({ path: 'output/cinema/08-version-desktop.png' })
  console.log('✓ The player version switch loads the same episode in Sub or Dub using separate saved pages')

  await page.getByRole('button', { name: 'Next episode in cinema' }).click()
  await page.waitForTimeout(250)
  assert.equal(requests.at(-1).episode, 26)
  assert.equal(requests.at(-1).url, saved.pages['1:26:dub'])
  const cancelled = pending
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await cancelled.fulfill({ json: { source, pageUrl: saved.pages['1:26:dub'], title: 'Cancelled source' } }).catch(() => {})
  await page.waitForTimeout(150)
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 0)
  console.log('✓ Next automatically resolves a fresh source and cancellation ignores a late response')

  await page.getByRole('button', { name: 'Find another match', exact: true }).click()
  await page.waitForTimeout(150)
  assert.equal(requests.at(-1).choose, true)
  assert.equal(requests.at(-1).url, undefined)
  await pending.fulfill({ json: { kind: 'choices', message: 'Choose the matching WCO title.', choices: candidates.slice(0, 2) } })
  await page.getByLabel('WCO title matches').getByRole('button', { name: 'Cowboy Bebop', exact: true }).click()
  await page.waitForTimeout(150)
  assert.equal(requests.at(-1).url, series)
  await pending.fulfill({ status: 502, json: { code: 'access', error: 'WCO restricts this episode to premium accounts.' } })
  await page.getByRole('alert').filter({ hasText: 'premium accounts' }).waitFor()
  await page.getByRole('button', { name: 'Open WCO session', exact: true }).click()
  assert.equal(focused, 2)
  console.log('✓ Ambiguous matches are selectable in the cinema and provider errors remain visible')

  // Reproduce the screenshot: episode 1/Subbed, pasted episode 25/Dubbed.
  await page.getByLabel('Cinema episode number').fill('1')
  await page.getByLabel('Cinema episode number').press('Enter')
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Subbed', exact: true }).click()
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByText('Source options', { exact: true }).click()
  await page.getByLabel('WCO playback URL', { exact: true }).fill(episode)
  await page.getByRole('button', { name: 'Use this link', exact: true }).click()
  await page.waitForTimeout(250)
  assert.equal(await page.getByLabel('Cinema episode number').inputValue(), '25')
  assert.equal(await page.getByRole('button', { name: 'Dubbed', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(requests.at(-1).episode, 25)
  assert.equal(requests.at(-1).language, 'dub')
  assert.equal(requests.at(-1).url, episode)
  await pending.fulfill({ json: { kind: 'source', source, pageUrl: episode, language: 'dub', title: 'Cowboy Bebop: Episode 25 English Dubbed' } })
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  console.log('✓ Pasting episode 25 Dubbed while episode 1 Subbed is selected updates both controls and starts playback')

  // A delivery failure must recover the current episode without asking for a URL.
  await context.route(`${source}-failed`, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<p>Unavailable fixture source</p>' }))
  await context.route(`${source}-retry`, (route) => route.fulfill({ contentType: 'video/webm', body: bytes }))
  await page.locator('video').evaluate((video, url) => { video.src = url }, `${source}-failed`)
  await page.getByRole('alert').filter({ hasText: 'WCO’s video could not load in this browser' }).waitFor()
  await page.getByRole('button', { name: 'Retry episode', exact: true }).click()
  await page.waitForTimeout(150)
  assert.equal(requests.at(-1).refresh, true)
  assert.equal(requests.at(-1).episode, 25)
  assert.equal(requests.at(-1).url, episode)
  await pending.fulfill({ json: { kind: 'source', source: `${source}-retry`, pageUrl: episode, language: 'dub', title: 'Cowboy Bebop: Episode 25 English Dubbed' } })
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  assert.equal(await page.locator('.cinema-media-error').count(), 0)
  console.log('✓ Browser selection accompanies every provider request, and failed delivery retries the same episode')

  // Changing away from a pending request must never play its late response.
  await page.getByRole('button', { name: 'Next episode in cinema' }).click()
  await page.waitForTimeout(150)
  const stale = pending
  await page.getByRole('button', { name: 'Previous episode in cinema' }).click()
  await page.waitForTimeout(150)
  const current = pending
  await stale.fulfill({ json: { source, pageUrl: saved.pages['1:26:dub'], title: 'Wrong stale episode' } }).catch(() => {})
  await page.waitForTimeout(100)
  assert.equal(await page.locator('video').count(), 0)
  await current.fulfill({ status: 409, json: { error: 'Previous preparation is closing.' } })
  await page.waitForTimeout(500)
  assert.equal(requests.at(-1).episode, 25)
  assert.notEqual(pending, current)
  await pending.fulfill({ json: { source, pageUrl: episode, language: 'dub', title: 'Cowboy Bebop: Episode 25 English Dubbed' } })
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library[0].progress), 24)
  assert.deepEqual(errors, [])
  console.log('✓ Rapid episode changes discard stale results, retry a closing resolver and leave watch progress unchanged')
  await page.setViewportSize({ width: 390, height: 844 })
  const dimensions = await page.locator('.watch-cinema').evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, viewport: innerWidth }))
  assert.ok(dimensions.scroll <= dimensions.width + 1 && dimensions.width <= dimensions.viewport)
  await mkdir('output/cinema', { recursive: true })
  await page.screenshot({ path: 'output/cinema/07-wco-mobile.png' })
  await version.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'output/cinema/09-version-mobile.png' })
  await page.getByRole('button', { name: 'Dock mini-player', exact: true }).click()
  assert.equal(await version.isVisible(), true)
  const dock = await page.locator('.watch-cinema').boundingBox()
  const switchBounds = await version.boundingBox()
  assert.ok(switchBounds.x >= dock.x && switchBounds.x + switchBounds.width <= dock.x + dock.width + 1)
  assert.ok(switchBounds.y + switchBounds.height <= dock.y + dock.height + 1)
  await page.screenshot({ path: 'output/cinema/10-version-dock.png' })
  console.log('✓ The inline WCO controls fit a 390px mobile viewport')
} finally {
  await browser?.close()
  await server.close()
}
