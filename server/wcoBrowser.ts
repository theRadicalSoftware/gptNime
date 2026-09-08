import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, chmod } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type Page } from 'playwright'

export const wcoProfileDirectory = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'gptnime', 'wco-browser')
export class WcoBrowserError extends Error {}

async function localPort(): Promise<number> {
  const socket = createServer()
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve) })
  const port = (socket.address() as { port: number }).port
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return port
}

// One ordinary Chrome process, with its own persistent data directory. DevTools
// observes provider pages; it never reads a personal profile or solves a challenge.
// Do not add stealth scripts, fingerprint overrides or disabled browser protections.
export class WcoBrowser {
  private browser: Browser | null = null
  private process: ChildProcess | null = null
  private starting: Promise<Browser> | null = null
  private page: Page | null = null
  private closing = false
  private stopping: Promise<void> | null = null
  private preparing = false

  constructor(private executable: string, private profile = wcoProfileDirectory) {}

  private async start(): Promise<Browser> {
    await mkdir(this.profile, { recursive: true, mode: 0o700 })
    await chmod(this.profile, 0o700)
    const port = await localPort()
    const child = spawn(this.executable, [
      `--user-data-dir=${this.profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
      '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1100,860', '--new-window', 'about:blank',
    ], { stdio: 'ignore' })
    this.process = child
    let failed = false
    child.once('error', () => { failed = true })
    try {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (this.closing || failed || child.exitCode !== null || child.signalCode !== null) break
        const endpoint = `http://127.0.0.1:${port}`
        const ready = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) }).then((response) => response.ok, () => false)
        if (ready) {
          const browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
          if (this.closing) { await browser.close(); break }
          this.browser = browser
          browser.on('disconnected', () => { if (this.browser === browser) { this.browser = null; this.page = null } })
          return browser
        }
        await delay(200)
      }
    } catch { /* Do not expose browser endpoints or diagnostics to the UI. */ }
    child.kill('SIGTERM')
    throw new WcoBrowserError('The dedicated WCO Chrome session could not open. If its previous window is still closing, wait a moment and retry playback.')
  }

  async getPage(): Promise<Page> {
    if (this.closing) throw new Error('The WCO connector is shutting down.')
    if (!this.browser?.isConnected()) {
      this.starting ??= this.start().finally(() => { this.starting = null })
      await this.starting
    }
    if (!this.page || this.page.isClosed()) {
      const context = this.browser!.contexts()[0]
      this.page = context.pages().find((page) => page.url() === 'about:blank') || await context.newPage()
      this.page.on('popup', (popup) => { if (this.preparing) void popup.close().catch(() => {}) })
    }
    return this.page
  }

  async show(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false
    await this.windowState(this.page, 'normal')
    await this.page.bringToFront()
    return true
  }

  setPreparing(preparing: boolean) {
    // Suppress popups from automated player controls, while allowing a person
    // to open the provider's sign-in page after an access/verification message.
    this.preparing = preparing
  }

  async park(page: Page) {
    if (page.isClosed()) return
    // Release provider media after handing it to the cinema, preserving cookies.
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {})
    await this.windowState(page, 'minimized')
  }

  async cancel(page: Page) {
    if (page.isClosed()) return
    // Keep a blank tab so cancelling does not close Chrome's last window.
    // This also interrupts an in-flight navigation without erasing its profile.
    if (!this.closing && this.browser?.isConnected()) {
      this.page = await page.context().newPage().catch(() => null)
      this.page?.on('popup', (popup) => { if (this.preparing) void popup.close().catch(() => {}) })
    }
    await page.close().catch(() => {})
  }

  private async windowState(page: Page, windowState: 'normal' | 'minimized') {
    const session = await page.context().newCDPSession(page).catch(() => null)
    if (!session) return
    try {
      const { windowId } = await session.send('Browser.getWindowForTarget')
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState } })
    } catch { /* A window manager may not support minimizing. */ }
    finally { await session.detach().catch(() => {}) }
  }

  close(): Promise<void> {
    this.stopping ??= this.shutdown()
    return this.stopping
  }

  private async shutdown() {
    this.closing = true
    await this.starting?.catch(() => {})
    // A CDP connection can disconnect without terminating ordinary Chrome.
    // Ask this dedicated browser to exit cleanly before releasing its process.
    const protocol = await this.browser?.newBrowserCDPSession().catch(() => null)
    await protocol?.send('Browser.close').catch(() => {})
    await this.browser?.close().catch(() => {})
    const child = this.process
    if (child && child.exitCode === null) {
      // Give Chrome time to flush its profile; terminate only this owned process.
      await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(3000)])
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(2000)])
      }
    }
    this.browser = null; this.page = null; this.process = null
  }
}
