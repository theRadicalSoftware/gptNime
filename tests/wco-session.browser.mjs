import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const vite = await createServer({ server: { middlewareMode: true, hmr: false } })
const fixture = httpServer((req, res) => {
  if (req.url === '/set') res.setHeader('Set-Cookie', 'gptnime-test-session=retained; Max-Age=3600; HttpOnly; SameSite=Lax')
  res.setHeader('Content-Type', 'text/html')
  res.end('<title>Session fixture</title><p>Local browser-session fixture</p>')
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${fixture.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'gptnime-session-test-'))
let session
try {
  const { WcoBrowser, backgroundRunner } = await vite.ssrLoadModule('/server/wcoBrowser.ts')
  const { PreparationBudget, waitForProvider, resolveWco } = await vite.ssrLoadModule('/server/wco.ts')
  const executable = process.env.CHROME_PATH || '/usr/bin/google-chrome'
  session = new WcoBrowser(executable, profile)
  const page = await session.getPage()
  const desktopWindows = async () => (await promisify(execFile)('xwininfo', ['-root', '-tree'])).stdout
  const hidden = !!await backgroundRunner()
  await page.goto(`${base}/set`)
  if (hidden) {
    assert.doesNotMatch(await desktopWindows(), /Session fixture/)
    console.log('✓ The preparation window is absent from the desktop window tree')
  }
  assert.equal((await stat(profile)).mode & 0o777, 0o700)
  const browser = page.context().browser()
  assert.equal(await session.getPage(), page)
  await session.cancel(page)
  const next = await session.getPage()
  assert.equal(next.context().browser(), browser)
  await next.goto(base)
  assert.equal((await next.context().cookies(base)).find((cookie) => cookie.name === 'gptnime-test-session')?.value, 'retained')
  console.log('✓ Cancelling replaces the work tab while keeping the same browser and its session')

  await Promise.all([session.close(), session.close()])
  session = new WcoBrowser(executable, profile)
  let reopened = await session.getPage()
  await reopened.goto(base)
  assert.equal((await reopened.context().cookies(base)).find((cookie) => cookie.name === 'gptnime-test-session')?.value, 'retained')
  console.log('✓ A private dedicated profile preserves its own session across Chrome restarts')

  // Simulated challenge state only: no provider, CAPTCHA or human control is used.
  await reopened.setContent('<title>Just a moment...</title><p>Verification state fixture</p>')
  const phases = []
  const budget = new PreparationBudget(100, 2500)
  const originalDeadline = budget.end
  const waiting = waitForProvider(reopened, budget, new AbortController().signal, (phase) => phases.push(phase), 'preparing')
  await reopened.waitForTimeout(250)
  await reopened.setContent('<title>Episode ready</title><p>Accepted-state fixture</p>')
  await waiting
  assert.deepEqual(phases, ['verification', 'preparing'])
  assert.ok(budget.end - originalDeadline >= 250)
  assert.ok(Date.now() < budget.end)
  assert.ok(budget.verificationRemaining < 2500)
  console.log('✓ Verification time extends the media deadline and accepted state resumes preparation')

  await reopened.setContent('<title>Just a moment...</title>')
  await assert.rejects(waitForProvider(reopened, new PreparationBudget(100, 50), new AbortController().signal, () => {}, 'preparing'), /session is kept/)
  assert.equal(reopened.isClosed(), false)
  assert.equal(await session.getPage(), reopened)
  const controller = new AbortController()
  const cancellation = waitForProvider(reopened, new PreparationBudget(), controller.signal, () => {}, 'preparing')
  controller.abort()
  await assert.rejects(cancellation, { name: 'AbortError' })
  assert.equal(await session.show(), true)
  console.log('✓ Verification expiry preserves the page; cancellation remains interruptible and the window can be shown')
  if (hidden) {
    const visible = await session.getPage()
    assert.equal(reopened.isClosed(), true)
    assert.match(await desktopWindows(), /Session fixture/)
    assert.equal(visible.url(), `${base}/`)
    assert.equal((await visible.context().cookies(base)).find((cookie) => cookie.name === 'gptnime-test-session')?.value, 'retained')
    await session.park(visible)
    assert.equal(visible.isClosed(), true)
    reopened = await session.getPage()
    await reopened.goto(base)
    assert.doesNotMatch(await desktopWindows(), /Session fixture/)
    assert.equal((await reopened.context().cookies(base)).find((cookie) => cookie.name === 'gptnime-test-session')?.value, 'retained')
    console.log('✓ Explicit Show transfers the same profile to the desktop; completion returns future work to a private display')
  }
  // Full resolver contract with intercepted provider fixtures, including a manual
  // login tab. This performs no real provider login, CAPTCHA or subscription.
  const episodeUrl = 'https://www.wco.tv/session-fixture-episode-755-english-subbed'
  const mediaUrl = 'https://fixture.wcostream.com/getvid?evid=fixture'
  const media = await readFile('tests/fixtures/cinema-test.webm')
  const context = reopened.context()
  let episodeLoads = 0
  let searches = 0
  await context.route('https://www.wco.tv/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    assert.notEqual(path, '/', 'Lookup should not load the homepage first')
    if (path === '/search') {
      searches++
      assert.equal(route.request().method(), 'POST')
      const fields = new URLSearchParams(route.request().postData())
      assert.equal(fields.get('catara'), 'Session Fixture episode 755')
      assert.equal(fields.get('konuara'), 'episodes')
      await route.fulfill({ contentType: 'text/html', body: `<title>Search</title><div id="sidebar_right2"><ul class="ul-episodes"><li><a href="${episodeUrl}">Session Fixture Episode 755 English Subbed</a></li></ul></div>` })
      return
    }
    if (route.request().url().endsWith('/fixture-login')) {
      await route.fulfill({ contentType: 'text/html', headers: { 'Set-Cookie': 'gptnime-test-login=accepted; Path=/; Secure; SameSite=Lax' }, body: '<title>Simulated account session</title><p>Local test fixture only</p>' })
      return
    }
    episodeLoads++
    const loggedIn = (await route.request().headerValue('cookie') || '').includes('gptnime-test-login=accepted')
    await route.fulfill({ contentType: 'text/html', body: `<title>Session Fixture Episode 755 English Subbed</title>${loggedIn ? '<iframe src="https://embed.wcostream.com/fixture-player"></iframe>' : '<h1>This Video Is for Premium Users</h1><a target="_blank" href="https://www.wco.tv/fixture-login">Fixture sign in</a>'}` })
  })
  await context.route('https://embed.wcostream.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<video src="${mediaUrl}" preload="metadata"></video>` }))
  await context.route(mediaUrl, (route) => route.fulfill({ contentType: 'video/webm', body: media }))
  const request = { url: episodeUrl, titles: ['Session Fixture'], episode: 755, language: 'sub', movie: false, choose: false }
  const checkpoints = new Map()
  // Preparation must not call the explicit user-facing focus action.
  const show = session.show.bind(session)
  session.show = async () => { assert.fail('Episode preparation stole window focus') }
  await assert.rejects(resolveWco(request, new AbortController().signal, session, checkpoints, () => {}), (error) => error.code === 'access')
  const popupPromise = context.waitForEvent('page')
  await reopened.getByRole('link', { name: 'Fixture sign in' }).click()
  const login = await popupPromise
  await login.waitForLoadState()
  assert.equal(login.isClosed(), false, 'The provider sign-in popup is available after an access error')
  const result = await resolveWco(request, new AbortController().signal, session, checkpoints, () => {})
  assert.equal(result.kind, 'source')
  assert.equal(result.source, mediaUrl)
  assert.equal(reopened.url(), 'about:blank')
  assert.equal(episodeLoads, 2)
  assert.deepEqual(await resolveWco(request, new AbortController().signal, session, checkpoints, () => {}), result)
  assert.equal(episodeLoads, 2, 'Returning to a recent episode avoids another provider preparation')
  await resolveWco({ ...request, refresh: true }, new AbortController().signal, session, checkpoints, () => {})
  assert.equal(episodeLoads, 3, 'Reload bypasses the recent source')
  const automatic = { ...request, url: undefined }
  assert.equal((await resolveWco(automatic, new AbortController().signal, session, checkpoints, () => {})).kind, 'source')
  assert.equal(searches, 1)
  assert.equal(episodeLoads, 4)
  await resolveWco(automatic, new AbortController().signal, session, checkpoints, () => {})
  assert.equal(searches, 1)
  assert.equal(episodeLoads, 4)
  console.log('✓ Direct normal search skips the homepage; recent sources avoid repeated preparation and Reload obtains a fresh source')
  const fallback = { ...automatic, language: 'dub' }
  assert.equal((await resolveWco(fallback, new AbortController().signal, session, checkpoints, () => {})).language, 'sub')
  assert.equal(searches, 2)
  assert.equal(episodeLoads, 5)
  assert.equal((await resolveWco(fallback, new AbortController().signal, session, checkpoints, () => {})).language, 'sub')
  assert.equal(episodeLoads, 5, 'The exact remembered language fallback can reuse its prepared source')
  session.show = show
  await login.close()
  await context.unrouteAll({ behavior: 'wait' })
  console.log('✓ Preparation never requests focus; access recovery reloads the episode with the accepted fixture session')
  await session.park(reopened)
  assert.equal(reopened.url(), 'about:blank')

  // Movie search/access/player regression using fixtures, never a real account.
  const movieUrl = 'https://www.wco.tv/naruto-the-movie-the-last-english-dubbed'
  const gurrenUrl = 'https://www.wco.tv/gurren-lagann-childhoods-end-fixture'
  const gurrenTitle = "Gurren Lagann The Movie: Childhood's End"
  let movieAccess = false
  let catalogueAccess = false
  let movieSearches = 0
  let movieLoads = 0
  await context.route('https://www.wco.tv/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/search') {
      movieSearches++
      const fields = new URLSearchParams(route.request().postData())
      assert.equal(fields.get('konuara'), 'episodes')
      assert.doesNotMatch(fields.get('catara'), /\bmovie\b/i)
      const link = fields.get('catara').includes('Naruto') ? `<a href="${movieUrl}">Naruto The Movie: The Last English Dubbed</a>` : '<a href="https://www.wco.tv/the-drawn-together-movie">The Drawn Together Movie</a>'
      return route.fulfill({ contentType: 'text/html', body: `<title>Search</title><div id="sidebar_right2"><ul class="ul-episodes"><li>${link}</li></ul></div>` })
    }
    if (path === '/movie-list') return route.fulfill({ contentType: 'text/html', body: `<title>Movies</title>${catalogueAccess ? `<div id="sidebar_right2"><a href="${gurrenUrl}">${gurrenTitle} English Dubbed</a></div>` : '<h1>This Video Is for Premium Users</h1>'}` })
    assert.ok([movieUrl, gurrenUrl].includes(route.request().url()))
    movieLoads++
    const title = path.includes('gurren') ? gurrenTitle : 'Naruto The Movie: The Last'
    return route.fulfill({ contentType: 'text/html', body: `<title>${title} English Dubbed</title>${movieAccess ? `<iframe src="https://embed.wcostream.com/fixture-player"></iframe><div class="prev-next"><a href="${episodeUrl}">Wrong Show Episode 2 English Dubbed</a></div>` : '<h1>This Video Is for Premium Users</h1>'}` })
  })
  await context.route('https://embed.wcostream.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<video src="${mediaUrl}" preload="metadata"></video>` }))
  await context.route(mediaUrl, (route) => route.fulfill({ contentType: 'video/webm', body: media }))
  session.show = async () => { assert.fail('Movie preparation stole window focus') }
  const film = { titles: ['The Last: Naruto the Movie'], episode: 1, movie: true, language: 'dub', choose: false }
  await assert.rejects(resolveWco(film, new AbortController().signal, session, checkpoints, () => {}), (error) => error.code === 'access' && /this movie/.test(error.message))
  assert.equal(movieSearches, 1)
  assert.equal(reopened.url(), movieUrl)
  movieAccess = true // Simulate the provider granting this fixture's access.
  const readyMovie = await resolveWco(film, new AbortController().signal, session, checkpoints, () => {})
  assert.equal(readyMovie.kind, 'source')
  assert.equal(readyMovie.source, mediaUrl)
  assert.equal(readyMovie.pageUrl, movieUrl)
  assert.equal(readyMovie.previousPage, null)
  assert.equal(readyMovie.nextPage, null)
  assert.equal(movieSearches, 1, 'Movie retry uses its saved selection')
  assert.equal(movieLoads, 2)
  const missing = { ...film, titles: [gurrenTitle] }
  await assert.rejects(resolveWco(missing, new AbortController().signal, session, checkpoints, () => {}), (error) => error.code === 'access' && /public search.*catalogue requires premium/.test(error.message))
  assert.equal(reopened.url(), 'https://www.wco.tv/movie-list')
  catalogueAccess = true
  assert.equal((await resolveWco(missing, new AbortController().signal, session, checkpoints, () => {})).pageUrl, gurrenUrl)
  assert.equal(reopened.url(), 'about:blank')
  session.show = show
  console.log('✓ Movies resolve automatically, surface access gates promptly, retry with the saved session and never inherit TV episode neighbors')
} finally {
  await session?.close()
  await vite.close()
  await new Promise((resolve) => fixture.close(resolve))
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
