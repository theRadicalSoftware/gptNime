import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, hmr: false } })
const { WcoPreparation, PreparationBusy } = await vite.ssrLoadModule('/server/wcoPreparation.ts')
const queue = new WcoPreparation()
const task = () => {
  let finish, signal, report, starts = 0, stops = 0
  const work = (input, phase) => {
    starts++; signal = input; report = phase
    return new Promise((resolve, reject) => {
      finish = resolve
      input.addEventListener('abort', () => { stops++; reject(input.reason) }, { once: true })
      input.throwIfAborted()
    })
  }
  return { work, finish: value => finish(value), report: phase => report(phase), get starts() { return starts }, get stops() { return stops }, get aborted() { return signal?.aborted } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
try {
  const episode = task()
  const warming = queue.prefetch('brave:episode1:sub', episode.work)
  await tick()
  assert.equal(queue.status.prefetching, true)
  const clicked = queue.resolve('brave:episode1:sub', episode.work, new AbortController().signal, 'clicked')
  assert.equal(queue.status.prefetching, false)
  assert.equal(queue.status.requestId, 'clicked')
  episode.report('verification')
  assert.equal(episode.aborted, false, 'An adopted job retains foreground manual verification')
  episode.finish('video')
  assert.equal(await clicked, 'video'); assert.equal(await warming, 'video')
  assert.equal(episode.starts, 1)
  console.log('✓ Clicking a warming episode adopts its existing work and verification state')

  const old = task(), chosen = task()
  const oldResult = queue.prefetch('brave:old:sub', old.work).catch(() => 'cancelled')
  await tick()
  const next = queue.resolve('chrome:chosen:dub', chosen.work, new AbortController().signal, 'next')
  await tick()
  assert.equal(await oldResult, 'cancelled')
  assert.equal(old.stops, 1); assert.equal(chosen.starts, 1)
  await assert.rejects(queue.resolve('brave:another:sub', task().work, new AbortController().signal, 'other'), PreparationBusy)
  assert.throws(() => queue.prefetch('brave:another:sub', task().work), PreparationBusy)
  assert.equal(chosen.aborted, false)
  chosen.finish('chosen'); assert.equal(await next, 'chosen')
  console.log('✓ A different click preempts background work, while foreground work rejects unrelated speculation')

  const shared = task(), first = new AbortController(), second = new AbortController()
  const one = queue.resolve('brave:shared:dub', shared.work, first.signal, 'one').catch(() => 'cancelled')
  const two = queue.resolve('brave:shared:dub', shared.work, second.signal, 'two')
  await tick(); first.abort()
  assert.equal(shared.aborted, false)
  shared.finish('shared')
  assert.equal(await one, 'cancelled'); assert.equal(await two, 'shared')
  assert.equal(shared.starts, 1)
  console.log('✓ One cancelling viewer cannot cancel another viewer of the same preparation')

  const gated = task()
  const gate = queue.prefetch('brave:gated:sub', gated.work).catch(() => 'paused')
  await tick(); gated.report('verification')
  assert.equal(await gate, 'paused'); assert.equal(gated.stops, 1)
  assert.equal(queue.status.busy, false)
  console.log('✓ Background verification stops quietly and releases the foreground slot')

  const cancelling = task(), controller = new AbortController()
  const cancelled = queue.resolve('brave:cancel:sub', cancelling.work, controller.signal, 'cancel').catch(() => 'cancelled')
  await tick(); controller.abort()
  assert.equal(await cancelled, 'cancelled'); assert.equal(cancelling.stops, 1)
  const shutdown = task()
  const done = queue.prefetch('brave:shutdown:sub', shutdown.work).catch(() => 'closed')
  await tick(); await queue.close()
  assert.equal(await done, 'closed')
  assert.throws(() => queue.prefetch('brave:new:sub', task().work), /shutting down/)
  console.log('✓ Cancellation and shutdown stop owned work and reject new preparation')
} finally { await queue.close(); await vite.close() }
