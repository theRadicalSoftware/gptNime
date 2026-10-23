import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Marking episodes watched as the cinema moves on, and bringing the player back
// after a refresh: same episode, same moment, and the pop-out one click away.
const port = Number(process.env.CONTINUITY_TEST_PORT) || 5189
const base = `http://127.0.0.1:${port}`
const video = await readFile('tests/fixtures/version-test.webm')
const source = 'https://fixture.wcostream.com/getvid?evid=private-continuity-fixture'
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } })
await server.listen()
const browsers = []
try {
  const launch = async (args = []) => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--mute-audio', ...args] })
    browsers.push(browser)
    return browser
  }
  const allowed = await launch(['--autoplay-policy=no-user-gesture-required'])

  const open = async (browser, { progress = 0, bookmarks = {} } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const now = new Date().toISOString()
    const entry = { id: '1', anilistId: 1, title: 'Continuity Fixture', progress, episodesTotal: 4, format: 'TV', status: 'watching', addedAt: now, updatedAt: now, detailsLoaded: true, episodeListLoaded: true, episodeList: [], genres: [], notes: '', rewatchStatus: 'none' }
    await context.addInitScript(({ ledger, bookmarks }) => {
      if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify(ledger))
      if (!localStorage.getItem('gptnime-cinema-v1')) localStorage.setItem('gptnime-cinema-v1', JSON.stringify({ autoMark: true, autoNext: true, language: 'sub', sourceTab: 'wco', bookmarks }))
    }, { ledger: { library: [entry], history: [] }, bookmarks })
    await context.route('https://graphql.anilist.co/**', route => route.fulfill({ json: { data: { Media: null } } }))
    await context.route('**/api/wco/status', route => route.fulfill({ json: { available: true, hiddenPreparation: true } }))
    await context.route('**/api/wco/focus', route => route.fulfill({ json: { shown: true } }))
    await context.route('**/api/wco/retain', route => route.fulfill({ json: { retained: true } }))
    await context.route('**/api/wco/prefetch', route => route.fulfill({ json: { ready: false } }))
    const resolutions = []
    await context.route('**/api/wco/resolve', route => {
      const request = route.request().postDataJSON(); resolutions.push(request)
      return route.fulfill({ json: { kind: 'source', source: `${source}-${request.episode}`, cached: false, playbackId: `f035ffca-9cbf-40ed-aa71-1573e70d08${String(request.episode).padStart(2, '0')}`, pageUrl: `https://www.wco.tv/continuity-fixture-episode-${request.episode}-english-subbed`, language: 'sub', title: `Continuity Fixture Episode ${request.episode}` } })
    })
    await context.route('https://fixture.wcostream.com/**', route => {
      const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1
      return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${video.length}` }, body: video.subarray(start, end + 1) })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base)
    const close = async () => { assert.deepEqual(errors, []); await context.close() }
    return { page, resolutions, close }
  }

  const start = async (page, episode = 1) => {
    await page.locator('.anime-tv-fab').click()
    await page.locator('.cinema-queue-row').click()
    if (episode !== 1) {
      const input = page.getByLabel('Cinema episode number')
      await input.fill(String(episode)); await input.press('Enter')
    }
    await page.waitForFunction(episode => { const v = document.querySelector('video'); return v && v.src.endsWith(`-${episode}`) && !v.paused && v.currentTime > .2 }, episode)
  }
  const state = page => page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused, rate: v.playbackRate, volume: v.volume, muted: v.muted, src: v.src, duration: v.duration }))
  // Really play a share of the 120-second fixture, fast, so it counts as watched.
  const watch = async (page, until) => {
    await page.locator('video').evaluate(v => { v.playbackRate = 16 })
    await page.waitForFunction(until => { const v = document.querySelector('video'); return v && v.currentTime >= until }, until, { timeout: 20_000 })
    await page.locator('video').evaluate(v => { v.playbackRate = 1 })
  }
  const seek = (page, time) => page.locator('video').evaluate((v, time) => { v.currentTime = time }, time)
  const progress = page => page.evaluate(() => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library[0].progress)
  const progressIs = (page, value) => page.waitForFunction(value => JSON.parse(localStorage.getItem('gptnime-tracker-library-v1')).library[0].progress === value, value)

  {
    const { page, close } = await open(allowed)
    await start(page)
    await watch(page, 64)
    await seek(page, 106)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Next episode in cinema' }).click()
    await progressIs(page, 1)
    await page.waitForFunction(() => document.querySelector('video')?.src.endsWith('-2'))
    console.log('✓ Moving on during the credits (Next or autoplay) marks the episode watched after half of it played')

    await watch(page, 30)
    await seek(page, 110)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Next episode in cinema' }).click()
    await page.waitForFunction(() => document.querySelector('video')?.src.endsWith('-3'))
    await page.waitForTimeout(300)
    assert.equal(await progress(page), 1, 'Seeking to the credits after a quarter does not count')
    console.log('✓ Jumping to the credits without watching most of the episode does not mark it')
    await close()
  }

  {
    // Episode 1 was played here but never marked: finishing episode 2 marks through 2.
    const { page, close } = await open(allowed, { bookmarks: { '1:1:wco': { time: 0, duration: 120, updatedAt: Date.now() - 60_000 } } })
    await start(page, 2)
    await watch(page, 109)
    await progressIs(page, 2)
    await close()
    const fresh = await open(allowed)
    await start(fresh.page, 3)
    await watch(fresh.page, 109)
    await fresh.page.waitForTimeout(500)
    assert.equal(await progress(fresh.page), 0, 'An episode far ahead of progress, with the one before it never played, is left to the person')
    await fresh.close()
    console.log('✓ A missed mark no longer blocks the next episode; a jump far ahead still is not marked automatically')
  }

  {
    const { page, resolutions, close } = await open(allowed)
    await start(page, 2)
    await watch(page, 40)
    await page.locator('video').evaluate(v => { v.playbackRate = 1.25; v.volume = .35 })
    const before = await state(page)
    await page.reload()
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.src.endsWith('-2') && !v.paused })
    const after = await state(page)
    assert.ok(after.time >= before.time - .3 && after.time < before.time + 3, `refresh resumed at ${after.time}, left at ${before.time}`)
    assert.equal(after.rate, 1.25); assert.equal(after.volume, .35)
    assert.equal(resolutions.at(-1).episode, 2)
    console.log('✓ A refresh during playback reopens the cinema on the same episode and second, with speed and volume, and keeps playing')

    await page.locator('video').evaluate(v => v.pause())
    await seek(page, 20)
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
    await page.reload()
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.src.endsWith('-2') && v.readyState >= 1 })
    await page.waitForTimeout(600)
    const paused = await state(page)
    assert.equal(paused.paused, true)
    assert.ok(Math.abs(paused.time - 20) < 1, `paused refresh resumed at ${paused.time}`)
    assert.equal(await page.locator('.cinema-resume').count(), 0, 'A paused episode returns paused, without a prompt')
    console.log('✓ A paused episode comes back paused at its moment')

    await page.getByRole('button', { name: 'Close cinema' }).click()
    await page.locator('.anime-tv-fab').waitFor()
    await page.reload()
    await page.locator('.anime-tv-fab').waitFor()
    await page.waitForTimeout(500)
    assert.equal(await page.locator('video').count(), 0, 'Closing the cinema means a refresh starts on the dashboard')
    console.log('✓ After closing the cinema, a refresh opens the dashboard as before')
    await close()
  }

  {
    // Resuming after a refresh counts the earlier part: watch 60%, refresh, finish.
    const { page, close } = await open(allowed)
    await start(page)
    await watch(page, 70)
    await page.reload()
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.src.endsWith('-1') && !v.paused && v.currentTime > 70 })
    await watch(page, 110)
    await progressIs(page, 1)
    console.log('✓ What was watched before a refresh counts toward marking the episode')
    await close()
  }

  {
    const { page, close } = await open(allowed)
    await start(page)
    await watch(page, 30)
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Pop out player' }).click()
    const child = await popup
    await child.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused })
    const left = (await child.locator('video').evaluate(v => v.currentTime))
    await page.reload()
    if (!child.isClosed()) await child.waitForEvent('close')
    const prompt = page.getByRole('button', { name: /^Pop out and continue at 0:\d\d$/ })
    await prompt.waitFor()
    const waiting = await state(page)
    assert.equal(waiting.paused, true, 'The restored player waits for the click instead of playing in the page')
    assert.ok(Math.abs(waiting.time - left) < 2, `restored at ${waiting.time}, left at ${left}`)
    await page.waitForTimeout(400)
    await page.locator('.cinema-screen').screenshot({ path: process.env.CONTINUITY_SHOTS ? `${process.env.CONTINUITY_SHOTS}/reopen.png` : undefined }).catch(() => {})
    const again = page.waitForEvent('popup')
    await prompt.click()
    const reopened = await again
    await reopened.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 1 })
    assert.ok(Math.abs((await reopened.locator('video').evaluate(v => v.currentTime)) - left) < 4)
    assert.equal(await page.locator('.cinema-resume').count(), 0)
    console.log('✓ After a refresh, a popped-out episode returns paused at its moment with one click to pop out and continue')
    await reopened.close()
    await close()
  }

  {
    // Chrome carries the earlier click across a same-origin refresh, so playback
    // usually continues by itself. A browser that wants a fresh click gets a
    // clear Continue button instead; simulate one that refuses play() until then.
    const { page, close } = await open(allowed)
    await start(page)
    await watch(page, 25)
    await page.context().addInitScript(() => {
      let clicked = false
      document.addEventListener('pointerdown', () => { clicked = true }, true)
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () { return clicked ? play.call(this) : Promise.reject(new DOMException('A click is required', 'NotAllowedError')) }
    })
    await page.reload()
    const prompt = page.getByRole('button', { name: /^Continue at 0:2\d$/ })
    await prompt.waitFor()
    await page.locator('.cinema-screen').screenshot({ path: process.env.CONTINUITY_SHOTS ? `${process.env.CONTINUITY_SHOTS}/blocked.png` : undefined }).catch(() => {})
    await prompt.click()
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 25 })
    assert.equal(await page.locator('.cinema-resume').count(), 0)
    console.log('✓ When the browser wants a click before playing, a clear Continue button resumes at the moment')
    await close()
  }
} finally {
  for (const browser of browsers) await browser.close()
  await server.close()
}
