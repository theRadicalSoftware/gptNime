import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const base = 'http://127.0.0.1:5195'
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }; assert.fail('Timed out waiting for fixture request') }
const server = await createServer({ server: { host: '127.0.0.1', port: 5195, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } })
  const now = new Date().toISOString()
  const entry = { id: '1', anilistId: 1, title: 'Cowboy Bebop', progress: 0, episodesTotal: 26, format: 'TV', status: 'watching', addedAt: now, updatedAt: now, detailsLoaded: true, episodeListLoaded: true, episodeList: [], genres: [], notes: '', rewatchStatus: 'none' }
  const ledger = { library: [entry, { ...entry, id: '2', anilistId: 2, title: 'Delicious in Dungeon', progress: 2, episodesTotal: 24 }], history: [] }
  const lastWatch = { anilistId: 2, episode: 2, language: 'dub', updatedAt: Date.now(), finished: false }
  await context.addInitScript(({ ledger, lastWatch }) => {
    if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify(ledger))
    if (!localStorage.getItem('gptnime-cinema-v1')) localStorage.setItem('gptnime-cinema-v1', JSON.stringify({ autoMark: false, language: 'dub', sourceTab: 'wco', lastWatch }))
  }, { ledger, lastWatch })
  await context.route('https://graphql.anilist.co/**', route => route.fulfill({ json: { data: { Media: null } } }))
  await context.route('**/api/wco/status', route => route.fulfill({ json: { available: true, hiddenPreparation: true } }))
  const prefetches = [], resolutions = [], retentions = []
  await context.route('**/api/wco/prefetch', route => { prefetches.push(route.request().postDataJSON()); return route.fulfill({ json: { ready: true, expiresAt: Date.now() + 90_000 } }) })
  await context.route('**/api/wco/retain', route => {
    assert.equal(route.request().headers()['x-wco-browser'], 'chrome')
    retentions.push(route.request().postDataJSON())
    return route.fulfill({ json: { retained: true } })
  })
  const bytes = await readFile('tests/fixtures/cinema-test.webm')
  const source = 'https://fixture.wcostream.com/getvid?evid=startup-fixture'
  const failedSource = `${source}-expired`
  await context.route(source, route => route.fulfill({ contentType: 'video/webm', body: bytes }))
  await context.route(failedSource, route => route.fulfill({ status: 404, contentType: 'text/html', body: 'Expired fixture' }))
  const playbackId = 'f035ffca-9cbf-40ed-aa71-1573e70d081b'
  const episodeUrl = 'https://www.wco.tv/delicious-in-dungeon-episode-2-english-dubbed'
  let expired = false, failedRefresh = false
  await context.route('**/api/wco/resolve', route => {
    const request = route.request().postDataJSON()
    resolutions.push(request)
    assert.equal(route.request().headers()['x-wco-browser'], 'chrome')
    return route.fulfill({ json: { kind: 'source', source: expired && (!request.refresh || failedRefresh) ? failedSource : source, cached: expired, playbackId, pageUrl: episodeUrl, language: 'dub', title: 'Delicious in Dungeon Episode 2 English Dubbed' } })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base)
  await until(() => prefetches.length > 0)
  assert.equal(prefetches[0].episode, 2)
  assert.equal(prefetches[0].language, 'dub')
  assert.deepEqual(prefetches[0].titles, ['Delicious in Dungeon'])
  assert.equal(resolutions.length, 0)
  assert.equal(await page.locator('video').count(), 0)
  await page.locator('.anime-tv-fab').click()
  assert.equal(await page.getByLabel('Cinema episode number').inputValue(), '2')
  assert.equal(resolutions.length, 0)
  console.log('✓ Refresh prepares the last unfinished selection quietly and reopens that episode without autoplay')

  await page.clock.install()
  await page.getByRole('button', { name: 'Play episode 2', exact: true }).first().click()
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0.3 })
  await until(() => retentions.length > 0)
  assert.deepEqual(retentions[0], { playbackId })
  const activeCount = retentions.length
  await page.clock.fastForward(31_000)
  await page.waitForTimeout(100)
  assert.ok(retentions.length > activeCount, 'Playing media renews its lease after 30 seconds')
  await page.locator('video').evaluate(video => video.pause())
  await page.waitForTimeout(100)
  const pausedCount = retentions.length
  await page.clock.fastForward(31_000)
  await page.waitForTimeout(100)
  assert.equal(retentions.length, pausedCount, 'Paused media stops retaining its source')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-cinema-v1')))
  assert.equal(saved.lastWatch.episode, 2)
  assert.equal(saved.lastWatch.language, 'dub')
  assert.equal(saved.lastWatch.finished, false)
  assert.ok(!JSON.stringify(saved).includes(playbackId) && !JSON.stringify(saved).includes('startup-fixture'))
  console.log('✓ Active playback renews an opaque lease; pause stops it, and storage contains only the stable selection and bookmark')

  await page.getByRole('button', { name: 'Close cinema', exact: true }).click()
  // Expired cached media retries once, with the original episode and language.
  expired = true
  const beforeRetry = resolutions.length
  await page.locator('.anime-tv-fab').click()
  await page.getByRole('button', { name: 'Play episode 2', exact: true }).first().click()
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0.3 && !v.error })
  assert.equal(resolutions.length, beforeRetry + 2)
  assert.equal(resolutions.at(-1).refresh, true)
  assert.equal(resolutions.at(-1).episode, 2)
  assert.equal(resolutions.at(-1).language, 'dub')
  assert.equal(resolutions.at(-1).url, episodeUrl)
  assert.equal(await page.locator('.cinema-media-error').count(), 0)
  console.log('✓ An expired cached URL automatically prepares the same episode once and resumes real decoded playback')

  await page.getByRole('button', { name: 'Close cinema', exact: true }).click()
  failedRefresh = true
  const beforeFailure = resolutions.length
  await page.locator('.anime-tv-fab').click()
  await page.getByRole('button', { name: 'Play episode 2', exact: true }).first().click()
  await page.getByRole('alert').filter({ hasText: 'WCO’s video could not load in this browser' }).waitFor()
  await page.waitForTimeout(500)
  assert.equal(resolutions.length, beforeFailure + 2, 'A failed fresh source cannot create an automatic retry loop')
  assert.equal(await page.getByRole('button', { name: 'Retry episode', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'Close cinema', exact: true }).click()
  console.log('✓ If the fresh source also fails, Retry remains available and automatic preparation stops')

  const selections = await page.evaluate(async ({ ledger, lastWatch }) => {
    const { recentWatch } = await import('/src/watch/watchState.ts')
    const choose = patch => { localStorage.setItem('gptnime-cinema-v1', JSON.stringify({ language: 'sub', sourceTab: 'wco', lastWatch: { ...lastWatch, updatedAt: Date.now() }, ...patch })); return recentWatch(ledger.library) }
    return {
      preferred: choose({})?.language,
      localFile: choose({ sourceTab: 'file' }),
      finished: choose({ lastWatch: { ...lastWatch, finished: true } }),
      old: choose({ lastWatch: { ...lastWatch, updatedAt: Date.now() - 25 * 60 * 60_000 } }),
      removed: choose({ lastWatch: { ...lastWatch, anilistId: 12345 } }),
      invalid: choose({ lastWatch: { ...lastWatch, episode: 25 } }),
    }
  }, { ledger, lastWatch })
  assert.deepEqual(selections, { preferred: 'sub', localFile: null, finished: null, old: null, removed: null, invalid: null })
  assert.deepEqual(errors, [])
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')))
  assert.deepEqual(stored.library.map(item => item.progress), [0, 2])
  console.log('✓ Startup respects current version preference, ignores finished/old/removed/invalid selections and preserves ledger progress')
} finally { await browser?.close(); await server.close() }
