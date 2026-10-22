import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium, devices } from 'playwright'
import { createServer } from 'vite'

// Home copy, daily backups, list import, This season, next-in-the-story and
// the phone media relay. The home copy lives in a throwaway directory.
const homeDirectory = await mkdtemp(join(tmpdir(), 'gptnime-home-'))
process.env.GPTNIME_LIBRARY_DIR = homeDirectory
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const key = 'gptnime-tracker-library-v1'
const now = new Date().toISOString()
const errors = []
const servers = []
let browser

const media = (id, title, extra = {}) => ({
  id, idMal: id + 1000, title: { romaji: title, english: title }, synonyms: [], format: 'TV', status: 'FINISHED', episodes: 12, duration: 24,
  description: '', season: 'FALL', seasonYear: 2026, coverImage: { large: '/art/rooftop.png' }, genres: [], tags: [], averageScore: 75,
  popularity: 1000, studios: { nodes: [{ name: 'Studio Fixture' }] }, relations: { edges: [] }, ...extra,
})
const relation = (type, node) => ({ relationType: type, node: { type: 'ANIME', status: 'FINISHED', coverImage: { large: '/art/citadel.png' }, ...node, title: { romaji: node.title, english: node.title } } })
const entry = (id, anilistId, title, extra = {}) => ({
  id, anilistId, title, progress: 0, episodesTotal: 12, format: 'TV', status: 'planning', addedAt: now, updatedAt: now,
  detailsLoaded: true, episodeListLoaded: true, coverImage: '/art/rooftop.png', genres: [], tags: [], studios: [], notes: '', rating: null,
  rewatchStatus: 'none', episodeList: [], ...extra,
})
const bebop = entry('bebop', 1, 'Cowboy Bebop', {
  status: 'watching', progress: 25, episodesTotal: 26, rating: 9, genres: ['Action', 'Sci-Fi'], tags: [{ name: 'Space', rank: 90 }], studios: ['Sunrise'],
  relations: [
    { anilistId: 5, title: 'Cowboy Bebop: The Movie', relationType: 'SEQUEL', format: 'MOVIE', releaseStatus: 'FINISHED', seasonYear: 2001, coverImage: '/art/citadel.png' },
    { anilistId: 6, title: 'Bebop Session OVA', relationType: 'SIDE_STORY', format: 'OVA', releaseStatus: 'FINISHED', seasonYear: 1999 },
    { anilistId: 20, title: 'Cowboy Bebop (Manga)', relationType: 'ADAPTATION', format: 'MANGA', releaseStatus: 'FINISHED' },
  ],
})
const dandy = entry('dandy', 2, 'Space Dandy', { status: 'completed', progress: 13, episodesTotal: 13, rating: 8, genres: ['Comedy', 'Sci-Fi'], studios: ['Bones'], completedAt: now })
const library = JSON.stringify({ library: [bebop, dandy], history: [] })

const anilist = {
  AnimeById: (id) => ({
    Media: id === 5 ? media(5, 'Cowboy Bebop: The Movie', { format: 'MOVIE', episodes: 1, relations: { edges: [relation('SEQUEL', { id: 7, title: 'Cowboy Bebop Season 2', format: 'TV', seasonYear: 2003 }), relation('PREQUEL', { id: 1, title: 'Cowboy Bebop', format: 'TV' })] } }) : media(id, `Title ${id}`),
  }),
  SeasonLineup: () => ({ Page: { pageInfo: { hasNextPage: false }, media: [
    media(10, 'Slice Cafe', { genres: ['Slice of Life'], popularity: 9000 }),
    media(9, 'Mecha Opera', { genres: ['Action', 'Sci-Fi'], tags: [{ name: 'Space', rank: 80 }], studios: { nodes: [{ name: 'Bones' }] }, popularity: 5000, nextAiringEpisode: { episode: 4, airingAt: Math.floor(Date.now() / 1000) + 86_400 } }),
    media(8, 'Space Dandy 2', { genres: ['Comedy'], relations: { edges: [{ relationType: 'PREQUEL', node: { id: 2, type: 'ANIME' } }] }, popularity: 3000 }),
  ] } }),
  ImportUser: () => ({ MediaListCollection: { lists: [{ entries: [
    { status: 'COMPLETED', progress: 12, score: 8.5, repeat: 1, notes: 'Loved it', updatedAt: 1_760_000_000, completedAt: { year: 2025, month: 3, day: 2 }, media: media(11, 'Imported Show') },
    { status: 'CURRENT', progress: 20, score: 0, media: media(1, 'Cowboy Bebop', { episodes: 26 }) },
    { status: 'CURRENT', progress: 3, score: 7, media: media(9, 'Mecha Opera') },
  ] }] } }),
  ImportByMal: (_id, variables) => ({ Page: { media: variables.ids.includes(1501) ? [media(12, 'From MAL', { idMal: 1501, episodes: 24 })] : [] } }),
}

async function open(options = {}, stored = library) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...options,
    storageState: { cookies: [], origins: [{ origin: base, localStorage: stored ? [{ name: key, value: stored }] : [] }] },
  })
  await context.route('https://graphql.anilist.co/**', (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    const name = Object.keys(anilist).find((query) => body.query?.includes(query))
    route.fulfill({ json: { data: name ? anilist[name](body.variables?.id, body.variables) : { Media: null } } })
  })
  await context.route('https://api.jikan.moe/**', (route) => route.fulfill({ json: { data: [] } }))
  await context.route('https://api.aniskip.com/**', (route) => route.fulfill({ status: 404, json: { found: false } }))
  await context.route('**/api/wco/**', (route) => route.fulfill({ json: { available: false } }))
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto(base)
  return { context, page }
}

const homeCopy = async () => JSON.parse(await readFile(join(homeDirectory, 'library.json'), 'utf8'))
const titles = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).library.map((item) => item.title).sort(), key)
const waitFor = async (check, message, timeout = 8000) => {
  const end = Date.now() + timeout
  for (;;) {
    try { if (await check()) return } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })

  // Merge rules, run in the browser exactly as the app runs them.
  {
    const { page, context } = await open({}, null)
    const result = await page.evaluate(async () => {
      const { mergeLibraries, fingerprint } = await import('/src/library/homeCopy.ts')
      const item = (id, anilistId, updatedAt, progress = 0) => ({ id, anilistId, title: id, updatedAt, progress })
      const t1 = '2026-10-01T00:00:00.000Z', t2 = '2026-10-02T00:00:00.000Z', t3 = '2026-10-03T00:00:00.000Z'
      const agreed = (items) => Object.fromEntries(items.map((entry) => [entry.id, `${fingerprint(entry)}@${new Date(entry.updatedAt).getTime()}`]))
      const a = item('a', 1, t1), b = item('b', 2, t1), c = item('c', 3, t1)
      const base = agreed([a, b, c])
      const ids = (list) => list.map((entry) => `${entry.id}:${entry.progress}`).sort().join(',')
      return {
        // b removed on the computer, c edited here, d added on the computer.
        threeWay: ids(mergeLibraries([a, b, item('c', 3, t2, 4)], [a, c, item('d', 4, t2)], base)),
        // Both sides edited a: the newer edit wins.
        bothEdited: ids(mergeLibraries([item('a', 1, t3, 7), b, c], [item('a', 1, t2, 5), b, c], base)),
        // An out-of-date browser copy cannot undo a newer agreed edit.
        stale: ids(mergeLibraries([item('a', 1, '2026-09-01T00:00:00.000Z', 1), b, c], [item('a', 1, t2, 6), b, c], agreed([item('a', 1, t2, 6), b, c]))),
        // An empty browser adopts the computer's library instead of deleting it.
        emptyLocal: ids(mergeLibraries([], [a, b, c], base)),
        // Mass removal is never inferred.
        mass: mergeLibraries([a], [a, b, c, item('e', 5, t1), item('f', 6, t1), item('g', 7, t1), item('h', 8, t1)], agreed([a, b, c, item('e', 5, t1), item('f', 6, t1), item('g', 7, t1), item('h', 8, t1)])).length,
        // The same show added separately keeps one record.
        duplicate: ids(mergeLibraries([item('x', 9, t2, 2)], [item('y', 9, t3, 3)], null)),
      }
    })
    assert.equal(result.threeWay, 'a:0,c:4,d:0')
    assert.equal(result.bothEdited, 'a:7,b:0,c:0')
    assert.equal(result.stale, 'a:6,b:0,c:0')
    assert.equal(result.emptyLocal, 'a:0,b:0,c:0')
    assert.equal(result.mass, 7)
    assert.equal(result.duplicate, 'y:3')
    await context.close()
  }

  // Server: owner-only files, refusals, and a start-of-day backup.
  {
    const { HomeCopy, localDate } = await server.ssrLoadModule('/server/library.ts')
    const directory = await mkdtemp(join(tmpdir(), 'gptnime-backups-'))
    let day = new Date(2026, 9, 1, 9)
    const copy = new HomeCopy(directory, () => day)
    const state = (count) => ({ library: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, anilistId: index + 1, title: `T${index}` })), history: [] })
    assert.equal((await copy.write(0, state(3))).revision, 1)
    assert.equal((await copy.write(0, state(1))).saved, false, 'A stale revision is refused')
    assert.equal((await copy.write(1, state(1))).revision, 2)
    const first = JSON.parse(await copy.backup('2026-10-01'))
    assert.equal(first.library.length, 3, 'The day keeps the library from before its first change')
    for (let index = 0; index < 34; index++) {
      day = new Date(2026, 9, 2 + index, 9)
      await copy.write((await copy.read()).revision, state(index + 2))
    }
    const backups = await copy.list()
    assert.equal(backups.length, 30, 'Thirty daily backups are kept')
    assert.equal(backups[0].date, localDate(day))
    assert.equal((await stat(join(directory, 'library.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(join(directory, 'backups'))).mode & 0o777, 0o700)
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    assert.equal(await copy.backup('../library'), null)
    await rm(directory, { recursive: true, force: true })
  }

  // The laptop browser saves its library to this computer.
  const laptop = await open()
  await laptop.page.locator('.home-copy-pill').filter({ hasText: 'Saved on this computer' }).waitFor()
  assert.deepEqual((await homeCopy()).library.map((item) => item.title).sort(), ['Cowboy Bebop', 'Space Dandy'])
  assert.equal((await readdir(join(homeDirectory, 'backups'))).filter((name) => name.endsWith('.json') && name !== 'index.json').length, 1)

  // A phone on the tunnel, with nothing stored, opens the same library.
  const phone = await open({ ...devices['Pixel 7'] }, null)
  await phone.page.locator('.home-copy-pill').filter({ hasText: 'Saved on this computer' }).waitFor()
  await waitFor(async () => (await titles(phone.page)).length === 2, 'The phone adopts the computer copy')
  assert.deepEqual(await titles(phone.page), ['Cowboy Bebop', 'Space Dandy'])
  const width = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  assert.ok(width, 'No sideways scrolling on a phone')

  // This season, on the phone: continuing shows first, then taste order.
  await phone.page.locator('.side-nav').getByRole('button', { name: 'This season' }).click()
  const panel = phone.page.locator('.season-panel')
  await panel.locator('.season-card').first().waitFor()
  assert.match(await panel.locator('.season-section').first().innerText(), /new seasons of shows you watch/i)
  assert.match(await panel.locator('.season-card').first().innerText(), /Space Dandy 2[\s\S]*Continues Space Dandy/)
  const picked = await panel.locator('.season-grid').nth(1).locator('h3').allInnerTexts()
  assert.deepEqual(picked, ['Mecha Opera', 'Slice Cafe'], 'Taste, not raw popularity, orders the lineup')
  assert.match(await panel.locator('.season-card', { hasText: 'Mecha Opera' }).innerText(), /% match[\s\S]*You like (Sci-Fi|Action|Space)/)
  assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'The season page fits a phone')
  await panel.locator('.season-card', { hasText: 'Slice Cafe' }).getByRole('button', { name: 'Plan' }).click()
  await panel.locator('.season-card', { hasText: 'Slice Cafe' }).getByText('Plan to Watch').waitFor()
  assert.equal(await panel.isVisible(), true, 'One click adds to Planning without leaving the page')
  await panel.locator('.season-card', { hasText: 'Mecha Opera' }).getByRole('button', { name: 'Plan' }).click()
  await waitFor(async () => ['Slice Cafe', 'Mecha Opera'].every((title) => homeCopy().then((copy) => copy.library.some((item) => item.title === title))), 'The phone saves to the computer')
  await waitFor(async () => (await homeCopy()).library.filter((item) => ['Slice Cafe', 'Mecha Opera'].includes(item.title)).length === 2, 'Both plans reach the computer')

  // Back on the laptop, returning to the tab brings in the phone's change.
  await laptop.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitFor(async () => (await titles(laptop.page)).includes('Slice Cafe'), 'The laptop picks up the phone change')

  // A title removed on the laptop is removed on the phone, not resurrected.
  await laptop.page.locator('.side-nav').getByRole('button', { name: 'Library' }).click()
  await laptop.page.locator('.anime-card', { hasText: 'Slice Cafe' }).first().locator('.cover-button').click()
  await laptop.page.locator('.danger-button', { hasText: 'Remove' }).click()
  await waitFor(async () => !(await homeCopy()).library.some((item) => item.title === 'Slice Cafe'), 'The removal reaches the computer')
  await phone.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitFor(async () => !(await titles(phone.page)).includes('Slice Cafe'), 'The phone applies the removal')
  await phone.context.close()

  // Library and backups: AniList and MyAnimeList imports.
  const { page } = laptop
  await page.getByRole('button', { name: 'Library and backups' }).click()
  const vault = page.getByRole('dialog', { name: 'Library and backups' })
  await vault.getByText(/Saved on this computer/).waitFor()
  await vault.locator('.vault-backups li').first().waitFor()
  await vault.getByLabel('AniList username').fill('https://anilist.co/user/FixtureFan/')
  await vault.getByRole('button', { name: 'Import' }).click()
  await vault.locator('.vault-plan').waitFor()
  assert.match(await vault.locator('.vault-plan').innerText(), /New\s*1[\s\S]*Moved forward\s*1[\s\S]*Already up to date\s*1/)
  await vault.getByRole('button', { name: 'Add to my library' }).click()
  await vault.waitFor({ state: 'detached' })
  const imported = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).library, key)
  const show = imported.find((item) => item.title === 'Imported Show')
  assert.equal(show.status, 'completed'); assert.equal(show.progress, 12); assert.equal(show.rating, 8.5); assert.equal(show.notes, 'Loved it'); assert.equal(show.rewatchCount, 1)
  assert.equal(imported.find((item) => item.anilistId === 1).progress, 25, 'A tracked title never moves backwards')
  const opera = imported.find((item) => item.anilistId === 9)
  assert.equal(opera.progress, 3); assert.equal(opera.status, 'watching'); assert.equal(opera.rating, 7)

  const xml = `<?xml version="1.0" encoding="UTF-8"?><myanimelist><myinfo><user_name>fan</user_name></myinfo>
    <anime><series_animedb_id>1501</series_animedb_id><series_title><![CDATA[From MAL]]></series_title><my_watched_episodes>5</my_watched_episodes><my_score>7</my_score><my_status>Watching</my_status><my_priority>LOW</my_priority><my_comments><![CDATA[]]></my_comments><my_start_date>2026-01-04</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_times_watched>0</my_times_watched><my_rewatching>0</my_rewatching></anime>
    <anime><series_animedb_id>1502</series_animedb_id><series_title><![CDATA[Missing Show]]></series_title><my_watched_episodes>0</my_watched_episodes><my_score>0</my_score><my_status>Plan to Watch</my_status></anime>
  </myanimelist>`
  await page.getByRole('button', { name: 'Library and backups' }).click()
  await vault.getByLabel('MyAnimeList export file').setInputFiles({ name: 'animelist.xml.gz', mimeType: 'application/gzip', buffer: gzipSync(Buffer.from(xml)) })
  await vault.locator('.vault-plan').waitFor()
  assert.match(await vault.locator('.vault-plan').innerText(), /New\s*1[\s\S]*not found on AniList: Missing Show/)
  await vault.getByRole('button', { name: 'Add to my library' }).click()
  const fromMal = (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).library, key)).find((item) => item.title === 'From MAL')
  assert.equal(fromMal.status, 'watching'); assert.equal(fromMal.progress, 5); assert.equal(fromMal.priority, 'normal', 'MAL default Low priority is not copied')

  // Restoring a daily backup goes through the normal import preview.
  await page.getByRole('button', { name: 'Library and backups' }).click()
  await vault.locator('.vault-backups li').first().getByRole('button', { name: 'Restore…' }).click()
  const preview = page.getByRole('dialog', { name: 'Import library preview' })
  await preview.waitFor()
  assert.match(await preview.innerText(), /Backup from/)
  assert.match(await preview.locator('.import-mode-card-active').innerText(), /Replace/)
  await preview.getByRole('button', { name: 'Cancel' }).click()

  // Finishing a season offers what comes next, through the movie between seasons.
  await page.locator('.side-nav').getByRole('button', { name: 'Library' }).click()
  await page.locator('.anime-card', { hasText: 'Cowboy Bebop' }).first().locator('.cover-button').click()
  await page.getByRole('button', { name: 'Mark watched already' }).click()
  const card = page.getByRole('dialog', { name: /completion card/ })
  await card.locator('.story-next').waitFor()
  const story = await card.locator('.story-next').innerText()
  assert.match(story, /Next in the story[\s\S]*Cowboy Bebop: The Movie[\s\S]*Movie · 2001/i)
  assert.match(story, /Comes before Cowboy Bebop Season 2/)
  assert.match(story, /Optional: Bebop Session OVA \(OVA\)/)
  assert.doesNotMatch(story, /Manga/)
  await card.getByRole('button', { name: /Watch the movie/ }).click()
  await page.locator('.watch-cinema h2', { hasText: 'Cowboy Bebop: The Movie' }).waitFor()
  const movie = (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).library, key)).find((item) => item.anilistId === 5)
  assert.equal(movie.status, 'watching')
  await laptop.context.close()

  // The cinema's own finale card offers the next part too.
  {
    const special = entry('special', 30, 'Bebop Special', { format: 'SPECIAL', episodesTotal: 1, status: 'watching', relations: [{ anilistId: 31, title: 'Bebop Next', relationType: 'SEQUEL', format: 'TV', releaseStatus: 'NOT_YET_RELEASED', seasonYear: 2027 }] })
    const { page, context } = await open({}, JSON.stringify({ library: [special], history: [] }))
    await page.locator('.anime-tv-fab').click()
    await page.locator('.cinema-queue-row', { hasText: 'Bebop Special' }).click()
    await page.getByRole('button', { name: 'Your files' }).click()
    await page.getByLabel('Choose local video', { exact: true }).setInputFiles('tests/fixtures/cinema-test.webm')
    await page.waitForFunction(() => document.querySelector('.cinema-screen video')?.readyState >= 1)
    await page.evaluate(() => { const video = document.querySelector('.cinema-screen video'); video.muted = true; video.currentTime = Math.max(0, video.duration - 0.3); return video.play() })
    const finale = page.locator('.cinema-finished')
    await finale.locator('.story-next').waitFor()
    assert.match(await finale.innerText(), /That’s a wrap[\s\S]*Bebop Next[\s\S]*not out yet/)
    await finale.getByRole('button', { name: 'Plan it' }).click()
    await waitFor(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).library, key)).some((item) => item.anilistId === 31 && item.status === 'planning'), 'An unreleased sequel goes to Planning')
    await context.close()
  }

  // Phone media relay: only prepared sources, as the preparing browser, with ranges.
  {
    const { MediaRelays, RecentSources, relayMedia } = await server.ssrLoadModule('/server/wco.ts')
    let clock = 0
    const sources = new RecentSources(() => clock)
    const prepared = { kind: 'source', source: 'https://undisk4.wcostream.com/getvid?evid=fixture', pageUrl: 'https://www.wco.tv/cowboy-bebop-episode-1', title: 'Bebop 1', language: 'sub', notice: '', previousPage: null, nextPage: null }
    sources.put(prepared, 1, false)
    const relays = new MediaRelays(() => clock)
    assert.equal(relays.get('00000000-0000-0000-0000-000000000000', sources, 'UA'), null, 'Unknown leases relay nothing')
    assert.equal(relays.get(prepared.playbackId, sources, ''), null, 'No browser identity, no relay')
    assert.equal(relays.get(prepared.playbackId, sources, 'UA').source, prepared.source)
    clock = 11 * 60_000
    assert.equal(sources.find(prepared.playbackId), undefined)
    assert.ok(relays.get(prepared.playbackId, sources, 'UA'), 'A relay that started keeps serving the episode being watched')
    clock = 5 * 60 * 60_000
    assert.equal(relays.get(prepared.playbackId, sources, 'UA'), null, 'Relays end within hours')

    const forbidden = await fetch(`${base}/api/wco/media/brave/${prepared.playbackId}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(forbidden.status, 403, 'Other sites cannot embed the relay')
    const missing = await fetch(`${base}/api/wco/media/brave/${prepared.playbackId}`)
    assert.equal(missing.status, 404)

    const video = await readFile('tests/fixtures/version-test.webm')
    const seen = []
    const cdn = createHttpServer((req, res) => {
      seen.push({ agent: req.headers['user-agent'], cookie: req.headers.cookie, referer: req.headers.referer, range: req.headers.range })
      if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>not video</p>'); return }
      const [start, end] = (req.headers.range?.match(/bytes=(\d*)-(\d*)/)?.slice(1) || ['0', '']).map((value, index) => value === '' ? (index ? video.length - 1 : 0) : Number(value))
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}) })
      res.end(video.subarray(start, end + 1))
    })
    const relay = createHttpServer((req, res) => {
      if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<video src="/media" muted playsinline></video>'); return }
      void relayMedia(req, res, { source: `http://127.0.0.1:${cdn.address().port}${req.url === '/html' ? '/page' : '/media'}`, agent: 'GPTNime-Fixture-Browser/1', until: Date.now() + 60_000 })
    })
    servers.push(cdn, relay)
    await Promise.all([cdn, relay].map((item) => new Promise((resolve) => item.listen(0, '127.0.0.1', resolve))))
    const relayBase = `http://127.0.0.1:${relay.address().port}`
    assert.equal((await fetch(`${relayBase}/html`)).status, 502, 'Provider pages never reach the phone')
    const context = await browser.newContext({ ...devices['Pixel 7'] })
    const phonePage = await context.newPage()
    await phonePage.goto(relayBase)
    await phonePage.waitForFunction(() => document.querySelector('video').readyState >= 1)
    await phonePage.evaluate(async () => { const element = document.querySelector('video'); element.currentTime = element.duration - 2; await element.play() })
    await phonePage.waitForFunction(() => document.querySelector('video').currentTime > document.querySelector('video').duration - 1.5)
    const ranged = seen.filter((item) => item.range)
    assert.ok(ranged.length > 0, 'Seeking uses ranges through the relay')
    assert.ok(seen.every((item) => item.agent === 'GPTNime-Fixture-Browser/1' && !item.cookie && !item.referer), 'The relay asks as the preparing browser, without cookies or referrer')
    await context.close()
  }

  assert.deepEqual(errors, [])
  console.log('Platform checks passed: merge rules, home copy and 30 daily backups, phone adoption and two-way changes, This season, AniList and MyAnimeList import, backup restore, next in the story, phone media relay.')
} finally {
  await browser?.close()
  servers.forEach((item) => item.close())
  await server.close()
  await rm(homeDirectory, { recursive: true, force: true })
}
