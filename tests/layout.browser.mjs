import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Where the page lands: opening a title from anywhere shows its details from
// the top, the library keeps your place in the grid, and the details panel's
// fold-away sections remember how you left them.
const port = Number(process.env.LAYOUT_TEST_PORT) || 5187
const base = `http://127.0.0.1:${port}`
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  const now = Date.now()
  const library = Array.from({ length: 36 }, (_, index) => ({
    id: `title-${index}`, anilistId: 1000 + index, title: `Layout Title ${index + 1}`, progress: index % 5, episodesTotal: 12, format: 'TV', status: index % 3 ? 'watching' : 'planning',
    addedAt: new Date(now - index * 60_000).toISOString(), updatedAt: new Date(now - index * 60_000).toISOString(), detailsLoaded: true, episodeListLoaded: true, genres: ['Action'], studios: ['Fixture Studio'], notes: '', rewatchStatus: 'none',
    description: 'A long synopsis. '.repeat(40),
    staff: Array.from({ length: 12 }, (_, n) => ({ id: n + 1, name: `Staff ${n + 1}`, role: 'Animation' })),
    characters: Array.from({ length: 10 }, (_, n) => ({ id: n + 1, name: `Character ${n + 1}`, role: 'MAIN' })),
    episodeList: Array.from({ length: 12 }, (_, n) => ({ number: n + 1, title: `Episode ${n + 1}` })),
  }))
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport })
    await context.addInitScript((library) => {
      if (!localStorage.getItem('gptnime-tracker-library-v1')) localStorage.setItem('gptnime-tracker-library-v1', JSON.stringify({ library, history: [] }))
    }, library)
    await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ json: { data: { Media: null, Page: { media: [] } } } }))
    await context.route('**/api/wco/**', (route) => route.fulfill({ json: { available: false } }))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(base)
    return { page, context, errors }
  }
  const panelTitle = (page) => page.locator('.detail-panel h2').innerText()
  const inView = (page, selector) => page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.top >= 0 && box.top < window.innerHeight * 0.5
  })

  {
    const { page, context, errors } = await open({ width: 1600, height: 900 })
    // From far down the dashboard, a title opens at the top of the library with its details.
    const poster = page.locator('.mini-cover-row button').nth(2)
    await poster.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => window.scrollY) > 300)
    const wanted = await poster.getAttribute('title')
    await poster.click()
    await page.locator('.detail-panel h2', { hasText: wanted }).waitFor()
    assert.equal(await page.evaluate(() => window.scrollY), 0)
    assert.equal(await page.locator('.detail-panel').evaluate((panel) => panel.scrollTop), 0)
    console.log('✓ A title opened from far down the dashboard shows the library and its details from the top')

    // In the library, the details scroll beside the grid and reset for each title.
    await page.locator('.detail-panel').evaluate((panel) => { panel.scrollTop = panel.scrollHeight })
    const card = page.locator('.anime-card').nth(30)
    await card.scrollIntoViewIfNeeded()
    const gridAt = await page.evaluate(() => window.scrollY)
    assert.ok(gridAt > 600)
    await card.locator('.cover-button').click()
    await page.locator('.detail-panel h2', { hasText: 'Layout Title 31' }).waitFor()
    assert.equal(await page.locator('.detail-panel').evaluate((panel) => panel.scrollTop), 0)
    assert.ok(await inView(page, '.detail-panel'), 'The details stay in view beside the grid')
    assert.equal(await page.evaluate(() => window.scrollY), gridAt, 'The grid keeps your place')
    console.log('✓ Choosing a card low in the grid keeps your place and shows its details from the top')

    // Other pages also start at their top.
    await page.locator('.side-nav').getByRole('button', { name: 'History' }).click()
    await page.waitForFunction(() => window.scrollY === 0)
    console.log('✓ Every page opens at its top')

    // The panel leads with the essentials; long sections fold away and remember it.
    await page.locator('.side-nav').getByRole('button', { name: 'Library' }).click()
    const drawer = page.locator('.detail-drawer', { hasText: 'Cast and staff' })
    await drawer.waitFor()
    assert.equal(await drawer.evaluate((element) => element.open), false)
    assert.equal(await page.locator('.credit-row').count(), 0, 'Closed sections render nothing')
    assert.match(await drawer.locator('summary').innerText(), /10 characters · 12 staff/)
    await page.getByRole('button', { name: 'Read more' }).waitFor()
    await drawer.locator('summary').click()
    await page.locator('.credit-row').first().waitFor()
    await page.reload()
    await page.locator('.side-nav').getByRole('button', { name: 'Library' }).click()
    await page.locator('.credit-row').first().waitFor()
    console.log('✓ The details lead with the essentials; fold-away sections render only when open and remember it')
    assert.deepEqual(errors, [])
    await context.close()
  }

  {
    // Stacked on a phone, opening a title moves to its details.
    const { page, context, errors } = await open({ width: 390, height: 844 })
    await page.locator('.side-nav').getByRole('button', { name: 'Library' }).click()
    const card = page.locator('.anime-card').nth(6)
    await card.scrollIntoViewIfNeeded()
    await card.locator('.cover-button').click()
    await page.locator('.detail-panel h2', { hasText: 'Layout Title 7' }).waitFor()
    await page.waitForFunction(() => { const top = document.querySelector('.detail-panel').getBoundingClientRect().top; return top >= -2 && top < 140 })
    console.log('✓ On a phone, tapping a title brings its details into view')
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
