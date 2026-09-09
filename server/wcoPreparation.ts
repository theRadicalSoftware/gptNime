import type { ProviderPhase } from './wco'

type Work<T> = (signal: AbortSignal, report: (phase: ProviderPhase) => void) => Promise<T>
type Job<T> = {
  key: string; background: boolean; controller: AbortController; phase: ProviderPhase; requestId: string | null
  promise: Promise<T>; listeners: number; timer: ReturnType<typeof setTimeout>
}
export class PreparationBusy extends Error {}

// One provider operation at a time. A click adopts matching speculative work;
// a different click interrupts speculation before starting its own selection.
export class WcoPreparation<T> {
  private active: Job<T> | null = null
  private closing = false
  get status() {
    const job = this.active
    return { busy: !!job, prefetching: job?.background === true, phase: job?.phase || null, requestId: job?.requestId || null }
  }

  private deadline(job: Job<T>) {
    clearTimeout(job.timer)
    job.timer = setTimeout(() => job.controller.abort(), job.background ? 60_000 : 735_000)
    job.timer.unref()
  }

  private start(key: string, work: Work<T>, background: boolean): Job<T> {
    if (this.closing) throw new Error('The WCO connector is shutting down.')
    const controller = new AbortController()
    const job = { key, background, controller, phase: 'opening', requestId: null, listeners: 0 } as Job<T>
    this.active = job
    this.deadline(job)
    job.promise = Promise.resolve().then(() => work(controller.signal, (phase) => {
      job.phase = phase
      // Speculation never waits on a human check or shows a provider window.
      // A foreground click retains the normal manual-verification workflow.
      if (job.background && phase === 'verification') controller.abort()
    })).finally(() => {
      clearTimeout(job.timer)
      if (this.active === job) this.active = null
    })
    // A speculative HTTP client can leave before its bounded work completes.
    void job.promise.catch(() => {})
    return job
  }

  prefetch(key: string, work: Work<T>): Promise<T> {
    const job = this.active
    if (job && (job.key !== key || job.controller.signal.aborted)) throw new PreparationBusy()
    return (job || this.start(key, work, true)).promise
  }

  async resolve(key: string, work: Work<T>, signal: AbortSignal, requestId: string | null, refresh = false): Promise<T> {
    for (;;) {
      signal.throwIfAborted()
      const job = this.active
      if (job && (job.key !== key || refresh || job.controller.signal.aborted)) {
        if (!job.background) throw new PreparationBusy()
        job.controller.abort()
        await job.promise.catch(() => {})
        continue
      }
      const selected = job || this.start(key, work, false)
      if (selected.background) { selected.background = false; this.deadline(selected) }
      selected.requestId = requestId
      selected.listeners++
      // Background clients never own the foreground cancellation signal.
      let detached = false
      const detach = () => {
        if (detached) return
        detached = true
        selected.listeners--
        if (!selected.listeners && this.active === selected) selected.controller.abort()
      }
      signal.addEventListener('abort', detach, { once: true })
      try {
        signal.throwIfAborted()
        const result = await selected.promise
        signal.throwIfAborted()
        return result
      } finally { signal.removeEventListener('abort', detach); detach() }
    }
  }

  async close() {
    this.closing = true
    this.active?.controller.abort()
    await this.active?.promise.catch(() => {})
  }
}
