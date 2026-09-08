import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true } })
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
  const { WcoBrowser } = await vite.ssrLoadModule('/server/wcoBrowser.ts')
  const { PreparationBudget, waitForProvider, resolveWco } = await vite.ssrLoadModule('/server/wco.ts')
  const executable = process.env.CHROME_PATH || '/usr/bin/google-chrome'
  session = new WcoBrowser(executable, profile)
  const page = await session.getPage()
  await page.goto(`${base}/set`)
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
  const reopened = await session.getPage()
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
  // Full resolver contract with intercepted provider fixtures, including a manual
  // login tab. This performs no real provider login, CAPTCHA or subscription.
  const episodeUrl = 'https://www.wco.tv/session-fixture-episode-755-english-subbed'
  const mediaUrl = 'https://fixture.wcostream.com/getvid?evid=fixture'
  const media = await readFile('tests/fixtures/cinema-test.webm')
  const context = reopened.context()
  await context.route('https://www.wco.tv/**', async (route) => {
    if (route.request().url().endsWith('/fixture-login')) {
      await route.fulfill({ contentType: 'text/html', headers: { 'Set-Cookie': 'gptnime-test-login=accepted; Path=/; Secure; SameSite=Lax' }, body: '<title>Simulated account session</title><p>Local test fixture only</p>' })
      return
    }
    const loggedIn = (await route.request().headerValue('cookie') || '').includes('gptnime-test-login=accepted')
    await route.fulfill({ contentType: 'text/html', body: `<title>Session Fixture Episode 755 English Subbed</title>${loggedIn ? '<iframe src="https://embed.wcostream.com/fixture-player"></iframe>' : '<h1>This Video Is for Premium Users</h1><a target="_blank" href="https://www.wco.tv/fixture-login">Fixture sign in</a>'}` })
  })
  await context.route('https://embed.wcostream.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<video src="${mediaUrl}" preload="metadata"></video>` }))
  await context.route(mediaUrl, (route) => route.fulfill({ contentType: 'video/webm', body: media }))
  const request = { url: episodeUrl, titles: ['Session Fixture'], episode: 755, language: 'sub', movie: false, choose: false }
  const checkpoints = new Map()
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
  await login.close()
  await context.unrouteAll({ behavior: 'wait' })
  console.log('✓ An access gate leaves sign-in available, and Retry reloads the episode with the accepted fixture session')
  await session.park(reopened)
  assert.equal(reopened.url(), 'about:blank')
  assert.equal(await session.show(), true)
} finally {
  await session?.close()
  await vite.close()
  await new Promise((resolve) => fixture.close(resolve))
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
