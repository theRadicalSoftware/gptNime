import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// The home copy: the ledger saved on this computer, so a cleared browser, a
// second browser or a phone reached through an SSH tunnel all see the same
// library. Off unless GPTNIME_LIBRARY_DIR is set (the launcher sets it), so test
// suites and scratch servers can never write over the real library.
export const backupDays = 30
const maxBody = 48 * 1024 * 1024
const backupName = /^gptnime-(\d{4}-\d{2}-\d{2})\.json$/

type Snapshot = { revision: number; savedAt: string; library: unknown[]; history: unknown[] }
type BackupInfo = { date: string; savedAt: string; titles: number }
export type WriteResult = { saved: true; revision: number; savedAt: string } | { saved: false; current: Snapshot }

export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Shape checks only: the client normalizes every entry when it reads a copy.
export function validState(value: unknown): value is { library: Record<string, unknown>[]; history: unknown[] } {
  if (!value || typeof value !== 'object') return false
  const { library, history } = value as Record<string, unknown>
  return Array.isArray(library) && library.length <= 20_000 && Array.isArray(history) && history.length <= 2_000 &&
    library.every((entry) => entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'string' && Number.isFinite(Number((entry as Record<string, unknown>).anilistId)))
}

// Files are owner-only and replaced atomically, so a crash mid-save leaves the
// previous copy intact.
async function writePrivate(path: string, body: string) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, body, { mode: 0o600 })
  await rename(temporary, path)
}

export class HomeCopy {
  private current: Snapshot | null | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private index: Record<string, BackupInfo> | undefined
  constructor(private directory: string, private now: () => Date = () => new Date()) {}

  private get file() { return join(this.directory, 'library.json') }
  private get backups() { return join(this.directory, 'backups') }

  private async prepare() {
    await mkdir(this.backups, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    await chmod(this.backups, 0o700)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  async read(): Promise<Snapshot | null> {
    if (this.current !== undefined) return this.current
    const raw = await readFile(this.file, 'utf8').catch(() => null)
    let parsed: Partial<Snapshot> | null = null
    try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
    // An unreadable home copy is kept aside rather than overwritten.
    if (raw && (!parsed || !validState(parsed))) {
      await rename(this.file, join(this.directory, `library-unreadable-${Date.now()}.json`)).catch(() => {})
      parsed = null
    }
    const { revision, savedAt } = parsed || {}
    this.current = parsed && validState(parsed)
      ? { revision: Number.isInteger(revision) ? revision! : 1, savedAt: typeof savedAt === 'string' ? savedAt : this.now().toISOString(), library: parsed.library, history: parsed.history }
      : null
    return this.current
  }

  write(base: number, state: { library: unknown[]; history: unknown[] }): Promise<WriteResult> {
    return this.serial(async () => {
      const current = await this.read()
      if ((current?.revision || 0) !== base) return { saved: false, current: current || { revision: 0, savedAt: '', library: [], history: [] } }
      await this.prepare()
      const now = this.now()
      const next: Snapshot = { revision: base + 1, savedAt: now.toISOString(), library: state.library, history: state.history }
      // Each day's backup is the library as it stood before that day's first
      // change, so a bad save can never overwrite the copy that undoes it.
      await this.backupDay(localDate(now), current || next)
      await writePrivate(this.file, JSON.stringify({ version: 1, ...next }))
      this.current = next
      return { saved: true, revision: next.revision, savedAt: next.savedAt }
    })
  }

  private async readIndex() {
    if (this.index) return this.index
    const raw = await readFile(join(this.backups, 'index.json'), 'utf8').catch(() => '{}')
    try { this.index = JSON.parse(raw) } catch { this.index = {} }
    return this.index!
  }

  private async backupDay(date: string, snapshot: Snapshot) {
    const names = (await readdir(this.backups).catch(() => [] as string[])).filter((name) => backupName.test(name)).sort().reverse()
    if (names.includes(`gptnime-${date}.json`)) return
    await writePrivate(join(this.backups, `gptnime-${date}.json`), JSON.stringify({ version: 1, exportedAt: snapshot.savedAt, library: snapshot.library, history: snapshot.history }))
    const index = await this.readIndex()
    index[date] = { date, savedAt: snapshot.savedAt, titles: snapshot.library.length }
    const keep = [`gptnime-${date}.json`, ...names].slice(0, backupDays)
    for (const name of names.filter((name) => !keep.includes(name))) {
      await rm(join(this.backups, name), { force: true })
      delete index[name.match(backupName)![1]]
    }
    await writePrivate(join(this.backups, 'index.json'), JSON.stringify(index))
  }

  async list(): Promise<BackupInfo[]> {
    const names = (await readdir(this.backups).catch(() => [] as string[])).filter((name) => backupName.test(name)).sort().reverse()
    const index = await this.readIndex()
    return names.map((name) => {
      const date = name.match(backupName)![1]
      return index[date] || { date, savedAt: `${date}T00:00:00.000Z`, titles: 0 }
    })
  }

  async backup(date: string): Promise<string | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    return readFile(join(this.backups, `gptnime-${date}.json`), 'utf8').catch(() => null)
  }
}

const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

// Requests reach the app only from this computer: the browser here, or a phone
// whose SSH tunnel ends here. The custom header also keeps other web pages from
// sending these requests without a CORS preflight, which is never granted.
export function trustedRequest(req: IncomingMessage, write = false) {
  if (!loopbackAddresses.has(req.socket.remoteAddress || '')) return false
  try { if (!loopbackHosts.has(new URL(`http://${req.headers.host}`).hostname)) return false } catch { return false }
  if (req.headers['x-gptnime'] !== 'library') return false
  return !write || (req.headers.origin === `http://${req.headers.host}` && !!req.headers['content-type']?.startsWith('application/json'))
}

function send(res: ServerResponse, status: number, body: object | string) {
  if (res.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBody) throw new Error('Request is too large.')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function libraryMiddleware(copy: HomeCopy | null) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] || ''
    if (path !== '/api/library' && !path.startsWith('/api/library/')) { next(); return }
    if (!trustedRequest(req, req.method !== 'GET')) { send(res, 403, { error: 'The library is available only on this computer.' }); return }
    if (!copy) { send(res, 404, { enabled: false }); return }
    try {
      if (path === '/api/library' && req.method === 'GET') {
        const current = await copy.read()
        send(res, 200, current || { revision: 0, savedAt: null }); return
      }
      if (path === '/api/library/revision' && req.method === 'GET') {
        const current = await copy.read()
        send(res, 200, { revision: current?.revision || 0, savedAt: current?.savedAt || null }); return
      }
      if (path === '/api/library' && req.method === 'PUT') {
        const body = await readBody(req).catch(() => null)
        if (!body || !Number.isInteger(body.base) || body.base < 0 || !validState(body.state)) { send(res, 400, { error: 'Send a valid library.' }); return }
        const result = await copy.write(body.base, body.state)
        if ('current' in result) send(res, 409, result.current)
        else send(res, 200, result)
        return
      }
      if (path === '/api/library/backups' && req.method === 'GET') { send(res, 200, { backups: await copy.list(), keep: backupDays }); return }
      const date = path.match(/^\/api\/library\/backups\/(\d{4}-\d{2}-\d{2})$/)?.[1]
      if (date && req.method === 'GET') {
        const backup = await copy.backup(date)
        send(res, backup ? 200 : 404, backup || { error: 'That backup was not found.' }); return
      }
      send(res, 405, { error: 'Method not allowed.' })
    } catch {
      send(res, 500, { error: 'The library could not be saved on this computer.' })
    }
  }
}

// Every connection must start on this computer. Even if the server is started
// with a public --host by mistake, other machines are disconnected before any
// request is read. Pages are never indexed, framed or sent with a referrer.
function privateServer(server: { httpServer: { on: (event: 'connection', listener: (socket: Socket) => void) => unknown } | null; middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
  server.httpServer?.on('connection', (socket) => { if (!loopbackAddresses.has(socket.remoteAddress || '')) socket.destroy() })
  server.middlewares.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
}

export function libraryPlugin(): Plugin {
  const directory = process.env.GPTNIME_LIBRARY_DIR
  const copy = directory ? new HomeCopy(directory) : null
  const middleware = libraryMiddleware(copy)
  return {
    name: 'gptnime-home-copy',
    configureServer(server) {
      privateServer(server)
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
    },
    configurePreviewServer(server) {
      privateServer(server)
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
    },
  }
}
