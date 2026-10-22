import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// A stream that freezes partway through: the fixture answers the first part of
// the video, then holds the rest of the download open without a byte, the way
// a dropped tunnel or a stuck CDN connection looks to the browser.
const port = Number(process.env.RECOVERY_TEST_PORT) || 5193
const base = `http://127.0.0.1:${port}`
const cut = 150_000
const tail = 560_000
const video = await readFile('tests/fixtures/version-test.webm')
const source = 'https://fixture.wcostream.com/getvid?evid=private-recovery-fixture'
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--mute-audio'] })

  const open = async ({ down }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const now = new Date().toISOString()
    const entry = { id: '1', anilistId: 1, title: 'Recovery Fixture', progress: 0, episodesTotal: 2, format: 'TV', status: 'watching', addedAt: now, updatedAt: now, detailsLoaded: true, episodeListLoaded: true, episodeList: [], genres: [], notes: '', rewatchStatus: 'none' }
    await context.addInitScript(ledger => {
      if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify(ledger))
      if (!localStorage.getItem('gptnime-cinema-v1')) localStorage.setItem('gptnime-cinema-v1', JSON.stringify({ autoMark: true, language: 'sub', sourceTab: 'wco' }))
    }, { library: [entry], history: [] })
    await context.route('https://graphql.anilist.co/**', route => route.fulfill({ json: { data: { Media: null } } }))
    await context.route('https://api.aniskip.com/**', route => route.fulfill({ json: { found: false, results: [] } }))
    await context.route('**/api/wco/status', route => route.fulfill({ json: { available: true, hiddenPreparation: true } }))
    await context.route('**/api/wco/focus', route => route.fulfill({ json: { shown: true } }))
    await context.route('**/api/wco/retain', route => route.fulfill({ json: { retained: true } }))
    await context.route('**/api/wco/prefetch', route => route.fulfill({ json: { ready: false } }))
    const state = { down, held: [], resolutions: [], media: [] }
    await context.route('**/api/wco/resolve', route => {
      const request = route.request().postDataJSON(); state.resolutions.push(request)
      return route.fulfill({ json: { kind: 'source', source: `${source}-${request.episode}${request.refresh ? '-fresh' : ''}`, cached: !request.refresh, playbackId: 'f035ffca-9cbf-40ed-aa71-1573e70d0820', pageUrl: `https://www.wco.tv/recovery-fixture-episode-${request.episode}-english-subbed`, language: 'sub', title: `Recovery Fixture Episode ${request.episode}` } })
    })
    await context.route('https://fixture.wcostream.com/**', route => {
      const url = route.request().url()
      const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
      const start = range ? Number(range[1]) : 0
      state.media.push({ url, start })
      // The seek index at the end of the file always arrives; the middle can freeze.
      if (start >= cut && start < tail && state.down(url)) { state.held.push(route); return }
      // The first answer always ends at the cut, so the rest is a second request.
      const end = Math.min(range?.[2] ? Number(range[2]) : video.length - 1, start < cut ? cut - 1 : video.length - 1)
      return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${video.length}` }, body: video.subarray(start, end + 1) })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base)
    await page.locator('.anime-tv-fab').click()
    await page.locator('.cinema-queue-row').click()
    await page.waitForFunction(() => { const v = document.querySelector("video"); return v && !v.paused && v.currentTime > .3 })
    const close = async () => {
      for (const route of state.held) await route.abort().catch(() => {})
      assert.deepEqual(errors, [])
      await context.close()
    }
    return { page, state, close }
  }

  const playhead = page => page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused, src: v.src, rate: v.playbackRate, volume: v.volume, muted: v.muted }))
  // Play to the edge of what arrived; the held download then freezes playback.
  const freeze = async (page, settings = {}) => {
    const edge = await page.locator('video').evaluate((v, settings) => {
      Object.assign(v, settings)
      const end = v.buffered.length ? v.buffered.end(0) : 0
      v.currentTime = Math.max(0, end - 5)
      return end
    }, settings)
    assert.ok(edge > 10, `expected buffered video before the cut, got ${edge}`)
    await page.waitForFunction(edge => { const v = document.querySelector('video'); return v && !v.paused && v.readyState <= 2 && v.currentTime > edge - 4.5 }, edge, { timeout: 8000 })
    return (await playhead(page)).time
  }
  const playsPast = (page, time) => page.waitForFunction(time => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > time + 1.5 }, time, { timeout: 25_000 })
  const pill = page => page.locator('.cinema-recovery')
const shoot = (page, name) => process.env.RECOVERY_SHOTS ? page.locator('.cinema-screen').screenshot({ path: `${process.env.RECOVERY_SHOTS}/${name}.png` }) : undefined

  {
    // A short drop: the reconnect finds the network back and needs nothing from WCO.
    const { page, state, close } = await open({ down: () => true })
    const at = await freeze(page, { playbackRate: 1.25, volume: .4 })
    const started = Date.now()
    state.down = () => false
    await pill(page).filter({ hasText: /^Reconnecting · picking up at 0:\d\d$/ }).waitFor({ timeout: 16_000 })
    await shoot(page, 'reconnecting')
    const waited = (Date.now() - started) / 1000
    assert.ok(waited > 9 && waited < 15, `recovery began after ${waited}s`)
    await playsPast(page, at)
    const after = await playhead(page)
    assert.ok(after.time > at && after.time < at + 6, `resumed at ${after.time}, stalled at ${at}`)
    assert.equal(after.rate, 1.25); assert.equal(after.volume, .4)
    await pill(page).filter({ hasText: /^Picked up at 0:\d\d$/ }).waitFor()
    await shoot(page, 'picked-up')
    await pill(page).waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(state.resolutions.length, 1, 'Reconnecting reuses the same video without asking WCO')
    assert.equal(await page.locator('.cinema-media-error').count(), 0)
    assert.equal(after.src, `${source}-1`)
    await close()
    console.log('✓ A frozen stream reconnects quietly at the same second, speed and volume after about 12 seconds, then says so and fades')
  }

  {
    // The same video stays frozen: one fresh copy from WCO, picking up at that second.
    const { page, state, close } = await open({ down: url => !url.endsWith('-fresh') })
    const at = await freeze(page)
    await pill(page).filter({ hasText: 'Reconnecting' }).waitFor({ timeout: 16_000 })
    await pill(page).filter({ hasText: /^Getting a fresh copy · picking up at 0:\d\d$/ }).waitFor({ timeout: 16_000 })
    await playsPast(page, at)
    const after = await playhead(page)
    assert.equal(after.src, `${source}-1-fresh`)
    assert.ok(after.time > at && after.time < at + 6, `fresh copy resumed at ${after.time}, stalled at ${at}`)
    assert.equal(state.resolutions.length, 2)
    assert.equal(state.resolutions[1].refresh, true)
    await pill(page).filter({ hasText: 'Picked up at' }).waitFor()
    await close()
    console.log('✓ A stream that stays frozen gets one fresh WCO copy and continues from the same moment')
  }

  {
    // Nothing gets through: stop with a Retry that keeps the moment, without looping on WCO.
    const { page, state, close } = await open({ down: () => true })
    const at = await freeze(page)
    const card = page.locator('.cinema-media-error')
    await card.filter({ hasText: /stopped at 0:\d\d and couldn’t reconnect/ }).waitFor({ timeout: 45_000 })
    assert.equal(state.resolutions.length, 2, 'Only one fresh copy is requested before stopping')
    const retry = card.getByRole('button', { name: /^Retry from 0:\d\d$/ })
    await retry.waitFor()
    await shoot(page, 'stopped')
    await page.waitForTimeout(14_000)
    assert.equal(state.resolutions.length, 2, 'A stopped stream waits for the person')
    state.down = () => false
    await retry.click()
    await playsPast(page, at)
    const after = await playhead(page)
    assert.ok(after.time > at && after.time < at + 6, `retry resumed at ${after.time}, stalled at ${at}`)
    assert.equal(state.resolutions.length, 3)
    await pill(page).filter({ hasText: 'Picked up at' }).waitFor()
    await close()
    console.log('✓ When nothing gets through, a Retry card keeps the exact moment and no further requests are made until it is pressed')
  }

  {
    // Pausing during a freeze is the person's choice, not a stall.
    const { page, state, close } = await open({ down: () => true })
    await freeze(page)
    await page.locator('video').evaluate(v => v.pause())
    const requests = state.media.length
    const { src } = await playhead(page)
    await page.waitForTimeout(14_000)
    assert.equal(await pill(page).count(), 0)
    assert.equal(await page.locator('.cinema-media-error').count(), 0)
    assert.equal((await playhead(page)).src, src)
    assert.equal(state.resolutions.length, 1)
    assert.ok(state.media.length <= requests + 1)
    await close()
    console.log('✓ A paused video is never reloaded or reported, however long the download waits')
  }
} finally {
  await browser?.close()
  await server.close()
}
