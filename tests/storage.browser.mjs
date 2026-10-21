import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// An ephemeral port avoids colliding with other local development servers.
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const key = 'gptnime-tracker-library-v1'
const recoveryPrefix = `${key}-recovery-`
const now = new Date().toISOString()
const entry = (id, title, progress = 2) => ({
  id: String(id), anilistId: id, title, progress, episodesTotal: 12, format: 'TV', status: 'watching',
  addedAt: now, updatedAt: now, lastWatchedAt: now, detailsLoaded: true, episodeListLoaded: true,
  coverImage: '/art/rooftop.png', genres: [], notes: '', rating: null, rewatchStatus: 'none', episodeList: [],
})
const errors = []
let browser

async function open(value, failKeys = []) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: base, localStorage: value === undefined ? [] : [{ name: key, value }] }] },
  })
  // Simulate a full browser store for selected keys without touching real data.
  await context.addInitScript((failKeys) => {
    globalThis.__failKeys = failKeys
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, item) {
      if (globalThis.__failKeys.some((prefix) => name.startsWith(prefix))) throw new DOMException('Storage is full', 'QuotaExceededError')
      return setItem.call(this, name, item)
    }
  }, failKeys)
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: null } } }))
  await context.route('https://api.jikan.moe/**', (route) => route.fulfill({ json: { data: [] } }))
  await context.route('**/api/wco/**', (route) => route.fulfill({ json: { available: false } }))
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base)
  return { context, page }
}

const stored = (page, name = key) => page.evaluate((name) => localStorage.getItem(name), name)
const recoveries = (page) => page.evaluate((prefix) => Object.keys(localStorage).filter((name) => name.startsWith(prefix)).map((name) => ({ name, ...JSON.parse(localStorage.getItem(name)) })), recoveryPrefix)
const notice = (page) => page.locator('.storage-notice')

try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })

  {
    const corrupt = `{"library":[${JSON.stringify(entry(1, 'Cowboy Bebop'))},{"id":"2","title":"Cut off mid-save`
    const { context, page } = await open(corrupt)
    await notice(page).filter({ hasText: 'could not be read' }).waitFor()
    assert.match(await notice(page).innerText(), /recovery copy/)
    const [copy] = await recoveries(page)
    assert.equal(copy.raw, corrupt, 'The exact unreadable text is preserved before anything is saved')
    assert.equal(copy.reason, 'unreadable')
    const downloadPromise = page.waitForEvent('download')
    await notice(page).getByRole('button', { name: 'Download copy' }).click()
    const download = await downloadPromise
    assert.match(download.suggestedFilename(), /^gptnime-recovered-library-\d{4}-\d{2}-\d{2}\.txt$/)
    assert.equal(await readFile(await download.path(), 'utf8'), corrupt)
    await page.reload()
    await notice(page).filter({ hasText: 'recovery copy' }).waitFor()
    assert.equal((await recoveries(page)).length, 1, 'Reloading does not duplicate the recovery copy')
    await notice(page).getByRole('button', { name: 'Dismiss' }).click()
    assert.equal(await notice(page).count(), 0)
    await page.reload()
    await page.locator('.topbar').waitFor()
    assert.equal(await notice(page).count(), 0, 'A dismissed copy stays quiet')
    assert.equal((await recoveries(page))[0].raw, corrupt, 'Dismissing keeps the copy')
    await context.close()
    console.log('✓ Unreadable library text is preserved, downloadable and not duplicated before the empty session is saved')
  }

  {
    const original = JSON.stringify({ library: [entry(1, 'Cowboy Bebop'), { id: 'broken', title: '' }], history: [{ id: 'bad' }] })
    const { context, page } = await open(original)
    await notice(page).filter({ hasText: '1 saved title and 1 history event could not be read' }).waitFor()
    await page.getByText('Cowboy Bebop').first().waitFor()
    const [copy] = await recoveries(page)
    assert.equal(copy.raw, original)
    assert.equal(copy.skippedTitles, 1)
    assert.equal(copy.skippedEvents, 1)
    assert.equal(JSON.parse(await stored(page)).library.length, 1, 'The readable titles keep saving normally')
    await context.close()
    console.log('✓ Unreadable titles and events are reported and kept in a recovery copy; readable titles continue')
  }

  {
    const original = JSON.stringify({ library: [entry(1, 'Cowboy Bebop'), { id: 'broken' }], history: [] })
    const { context, page } = await open(original, [recoveryPrefix])
    await notice(page).filter({ hasText: 'saving is paused' }).waitFor()
    await page.getByTitle('Add one episode').first().click()
    await page.waitForTimeout(250)
    assert.equal(await stored(page), original, 'Without a recovery copy, the original is never overwritten')
    const downloadPromise = page.waitForEvent('download')
    await notice(page).getByRole('button', { name: 'Download original' }).click()
    assert.equal(await readFile(await (await downloadPromise).path(), 'utf8'), original)
    await notice(page).getByRole('button', { name: 'Resume saving' }).click()
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).library[0].progress === 3, key)
    assert.equal(await notice(page).count(), 0)
    await context.close()
    console.log('✓ With no room for a recovery copy, saving pauses until the person downloads the original and resumes')
  }

  {
    const original = JSON.stringify({ library: [entry(1, 'Cowboy Bebop')], history: [] })
    const { context, page } = await open(original)
    await page.getByTitle('Add one episode').first().waitFor()
    await page.evaluate((key) => { globalThis.__failKeys = [key] }, key)
    await page.getByTitle('Add one episode').first().click()
    await notice(page).filter({ hasText: 'could not be saved' }).waitFor()
    assert.equal(JSON.parse(await stored(page)).library[0].progress, 2)
    await page.getByText('Next ep 4').first().waitFor()
    await page.evaluate(() => { globalThis.__failKeys = [] })
    await notice(page).getByRole('button', { name: 'Try again' }).click()
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).library[0].progress === 3, key)
    assert.equal(await notice(page).count(), 0)
    assert.equal((await recoveries(page)).length, 0, 'A healthy library creates no recovery copy')
    await context.close()
    console.log('✓ A full browser store keeps the app running, warns once and saves again on retry')
  }

  {
    const { context, page } = await open(undefined)
    await page.locator('.topbar').waitFor()
    assert.equal(await notice(page).count(), 0)
    assert.deepEqual(JSON.parse(await stored(page)), { library: [], history: [] })
    await context.close()
    console.log('✓ A first visit starts cleanly with no storage notice')
  }

  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await server.close()
}
