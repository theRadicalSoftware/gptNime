import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const base = 'http://127.0.0.1:5194'
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }; assert.fail('Timed out waiting for fixture request') }
const server = await createServer({ server: { host: '127.0.0.1', port: 5194, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } })
  const now = new Date().toISOString()
  const entry = { id: '1', anilistId: 1, title: 'Version Fixture', progress: 0, episodesTotal: 2, format: 'TV', status: 'watching', addedAt: now, updatedAt: now, detailsLoaded: true, episodeListLoaded: true, episodeList: [], genres: [], notes: '', rewatchStatus: 'none' }
  const ledger = { library: [entry], history: [] }
  await context.addInitScript(ledger => {
    if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify(ledger))
    if (!localStorage.getItem('gptnime-cinema-v1')) localStorage.setItem('gptnime-cinema-v1', JSON.stringify({ autoMark: true, language: 'sub', sourceTab: 'wco' }))
  }, ledger)
  await context.route('https://graphql.anilist.co/**', route => route.fulfill({ json: { data: { Media: null } } }))
  await context.route('**/api/wco/status', route => route.fulfill({ json: { available: true, hiddenPreparation: true } }))
  const ids = { sub: 'f035ffca-9cbf-40ed-aa71-1573e70d081b', dub: 'f035ffca-9cbf-40ed-aa71-1573e70d081c' }
  const prefetches = [], resolutions = [], retentions = []
  let focused = 0, heldWarm, holdWarm = true
  await context.route('**/api/wco/focus', route => { focused++; return route.fulfill({ json: { shown: true } }) })
  await context.route('**/api/wco/prefetch', route => {
    const request = route.request().postDataJSON(); prefetches.push(request)
    if (holdWarm && request.language === 'dub' && request.episode === 1) { heldWarm = route; return }
    return route.fulfill({ json: { ready: true, expiresAt: Date.now() + 90_000, playbackId: ids[request.language], language: request.language } })
  })
  await context.route('**/api/wco/retain', route => {
    assert.equal(route.request().headers()['x-wco-browser'], 'chrome')
    retentions.push(route.request().postDataJSON())
    return route.fulfill({ json: { retained: true, alternateRetained: true } })
  })
  const [long, short] = await Promise.all([readFile('tests/fixtures/version-test.webm'), readFile('tests/fixtures/cinema-test.webm')])
  const source = 'https://fixture.wcostream.com/getvid?evid=private-version-fixture'
  await context.route('https://fixture.wcostream.com/**', route => {
    if (route.request().url().includes('expired')) return route.fulfill({ status: 404, contentType: 'text/html', body: 'Expired fixture' })
    const bytes = route.request().url().includes('-dub') ? short : long
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) })
  })
  let held, holdDub = false, expireDub = false
  const deliver = (route, request) => route.fulfill({ json: { kind: 'source', source: `${source}-${request.language}-${request.episode}${expireDub && request.language === 'dub' && !request.refresh ? '-expired' : ''}`, cached: resolutions.length > 1, playbackId: ids[request.language], pageUrl: `https://www.wco.tv/version-fixture-episode-${request.episode}-english-${request.language === 'sub' ? 'subbed' : 'dubbed'}`, language: request.language, title: `Version Fixture Episode ${request.episode} English ${request.language === 'sub' ? 'Subbed' : 'Dubbed'}` } })
  await context.route('**/api/wco/resolve', route => {
    const request = route.request().postDataJSON(); resolutions.push(request)
    assert.equal(route.request().headers()['x-wco-browser'], 'chrome')
    if (holdDub && request.language === 'dub') { held = { route, request }; return }
    return deliver(route, request)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base)
  await page.locator('.anime-tv-fab').click()
  await page.locator('.cinema-queue-row').click()
  const state = () => page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused, rate: v.playbackRate, volume: v.volume, muted: v.muted, duration: v.duration }))
  const seekPaused = async time => {
    await page.locator('video').evaluate((v, time) => { v.pause(); v.currentTime = time; v.playbackRate = 1.25; v.volume = .3; v.muted = true }, time)
    await page.waitForFunction(t => { const v = document.querySelector('video'); return v && !v.seeking && Math.abs(v.currentTime - t) < .1 }, time)
  }
  const select = async language => {
    await page.getByRole('button', { name: language === 'sub' ? 'Subbed' : 'Dubbed', exact: true }).click()
    await page.waitForFunction(language => { const v = document.querySelector('video'); return v && v.src.includes(`-${language}-`) && v.readyState >= 2 && !v.seeking && !v.error }, language)
  }
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > .3 })
  await until(() => !!heldWarm)
  await page.locator('video').evaluate(v => v.pause())
  await page.waitForTimeout(100)
  await heldWarm.fulfill({ json: { ready: true, expiresAt: Date.now() + 90_000, playbackId: ids.dub, language: 'dub' } }).catch(() => {})
  holdWarm = false
  await page.locator('video').evaluate(v => v.play())
  await until(() => retentions.some(item => item.playbackId === ids.sub && item.alternateId === ids.dub))
  assert.equal(resolutions.length, 1)
  assert.equal(prefetches.filter(item => item.episode === 1 && item.language === 'dub').length, 2)
  assert.equal((await state()).paused, false)
  console.log('✓ Pausing during preparation can resume it; both versions are then retained without interrupting playback')

  await seekPaused(7)
  await select('dub')
  let current = await state()
  assert.ok(Math.abs(current.time - 7) < .1)
  assert.equal(current.paused, true); assert.equal(current.rate, 1.25); assert.equal(current.volume, .3); assert.equal(current.muted, true)
  assert.ok(current.duration < 13)
  await seekPaused(8)
  await select('sub')
  assert.ok(Math.abs((await state()).time - 8) < .1)
  assert.ok((await state()).duration > 100)
  console.log('✓ Both switch directions use the current timestamp across different durations, preserving pause, rate, volume and mute')

  await seekPaused(9)
  await page.locator('video').evaluate(v => v.play())
  const before = (await state()).time
  await select('dub')
  await page.waitForFunction(t => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > t }, before)
  await seekPaused(1.4)
  await select('sub')
  assert.ok(Math.abs((await state()).time - 1.4) < .1)
  await seekPaused(0)
  await select('dub')
  assert.equal((await state()).time, 0)
  console.log('✓ Playing continues after a switch, including exact early-episode and zero-second positions')

  await select('sub')
  await seekPaused(6)
  await page.locator('video').evaluate(v => { v.dataset.bufferedVersionFixture = 'yes'; return v.play() })
  holdDub = true
  await page.getByRole('button', { name: 'Dubbed', exact: true }).click()
  await until(() => !!held)
  const beforeCancel = resolutions.length
  await select('sub')
  await page.waitForFunction(() => document.querySelector('video')?.paused === false)
  assert.equal(resolutions.length, beforeCancel, 'Returning to the still-buffered version needs no lookup')
  assert.equal(await page.locator('video').getAttribute('data-buffered-version-fixture'), 'yes')
  assert.ok((await state()).time >= 6)
  await deliver(held.route, held.request).catch(() => {})
  held = undefined; holdDub = false
  await page.waitForTimeout(150)
  assert.ok(await page.locator('video').evaluate(v => v.src.includes('-sub-')))
  console.log('✓ Rapid reversal cancels the pending switch, resumes the buffered version and ignores the late reply')

  await seekPaused(5)
  holdDub = true
  await page.getByRole('button', { name: 'Dubbed', exact: true }).click()
  await until(() => !!held)
  await held.route.fulfill({ status: 502, json: { error: 'Fixture version is temporarily unavailable.' } })
  await page.getByRole('alert').filter({ hasText: 'Fixture version is temporarily unavailable' }).waitFor()
  await select('sub')
  assert.equal((await state()).paused, true); assert.ok(Math.abs((await state()).time - 5) < .1)
  holdDub = false; held = undefined
  expireDub = true
  const beforeExpiry = resolutions.length
  await select('dub')
  assert.equal(resolutions.length, beforeExpiry + 2)
  assert.equal(resolutions.at(-1).refresh, true)
  assert.ok(Math.abs((await state()).time - 5) < .1)
  assert.equal((await state()).paused, true)
  expireDub = false
  console.log('✓ A failed switch leaves the old video recoverable; expired cached media refreshes without losing the carried position')

  await select('sub')
  await seekPaused(40)
  await select('dub')
  current = await state()
  assert.ok(current.time > 11 && current.time < current.duration)
  assert.equal(current.paused, true)
  await seekPaused(2.5)
  await page.getByRole('button', { name: 'Close cinema', exact: true }).click()
  await page.evaluate(() => { const state = JSON.parse(localStorage.getItem('gptnime-cinema-v1')); state.language = 'sub'; localStorage.setItem('gptnime-cinema-v1', JSON.stringify(state)) })
  await page.reload()
  await page.locator('.anime-tv-fab').click()
  await page.getByRole('button', { name: 'Play episode 1', exact: true }).first().click()
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime >= 2.5 })
  assert.ok((await state()).time < 4)
  console.log('✓ A shorter version clamps to its last frame, and a reload in another language uses the shared episode resume point')

  await page.getByRole('button', { name: 'Next episode in cinema' }).click()
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.src.endsWith('-sub-2') && !v.paused && v.currentTime > .1 })
  assert.ok((await state()).time < 1)
  await page.locator('video').evaluate(v => v.pause())
  const storage = await page.evaluate(() => ({ cinema: localStorage.getItem('gptnime-cinema-v1'), ledger: JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')) }))
  assert.ok(!storage.cinema.includes('private-version-fixture') && !storage.cinema.includes(ids.sub) && !storage.cinema.includes(ids.dub))
  assert.equal(storage.ledger.library[0].progress, 0); assert.deepEqual(storage.ledger.history, [])
  assert.equal(focused, 0); assert.deepEqual(errors, [])
  console.log('✓ Position transfer stays within the episode, never marks seeked time watched, never persists media/lease IDs and never focuses WCO')
} finally { await browser?.close(); await server.close() }
