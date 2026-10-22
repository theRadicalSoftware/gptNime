// Community opening/ending times from AniSkip, keyed by MyAnimeList id. They are
// offered as a Skip button only: another copy of an episode can be cut a few
// seconds differently, so the viewer decides.
export type SkipKind = 'opening' | 'ending' | 'recap'
export type SkipSegment = { kind: SkipKind; start: number; end: number }

const ANISKIP = 'https://api.aniskip.com/v2/skip-times'
const KINDS: Record<string, SkipKind> = { op: 'opening', 'mixed-op': 'opening', ed: 'ending', 'mixed-ed': 'ending', recap: 'recap' }
// Submissions are timed against one copy; a copy this much longer or shorter
// is likely a different cut, so its times are not offered.
const LENGTH_TOLERANCE = 12
const cache = new Map<string, Promise<unknown>>()

export const skipLabels: Record<SkipKind, string> = { opening: 'Skip opening', ending: 'Skip ending', recap: 'Skip recap' }

export function skipSegments(results: unknown, duration: number): SkipSegment[] {
  if (!Array.isArray(results) || !Number.isFinite(duration) || duration <= 0) return []
  const best = new Map<SkipKind, { segment: SkipSegment; offset: number }>()
  for (const result of results) {
    const kind = KINDS[result?.skipType]
    const start = Number(result?.interval?.startTime), end = Number(result?.interval?.endTime), length = Number(result?.episodeLength)
    if (!kind || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(length)) continue
    // An unknown submission length cannot be compared, so it ranks last.
    const difference = length > 0 ? duration - length : 0
    const offset = length > 0 ? Math.abs(difference) : LENGTH_TOLERANCE
    if (offset > LENGTH_TOLERANCE || offset >= (best.get(kind)?.offset ?? Infinity)) continue
    // Endings sit against the end of the file, so they follow a length difference.
    const shift = kind === 'ending' ? difference : 0
    const segment = { kind, start: Math.max(0, start + shift), end: Math.min(duration, end + shift) }
    if (segment.end - segment.start < 5 || segment.end - segment.start > 360) continue
    best.set(kind, { segment, offset })
  }
  return [...best.values()].map(({ segment }) => segment).sort((a, b) => a.start - b.start)
    .filter((segment, index, segments) => index === 0 || segment.start >= segments[index - 1].end)
}

export async function fetchSkipSegments(malId: number, episode: number, duration: number, signal: AbortSignal): Promise<SkipSegment[]> {
  if (!Number.isInteger(malId) || malId <= 0 || !Number.isInteger(episode) || episode <= 0) return []
  const key = `${malId}:${episode}`
  let request = cache.get(key)
  if (!request) {
    const types = Object.keys(KINDS).map((type) => `types=${type}`).join('&')
    request = fetch(`${ANISKIP}/${malId}/${episode}?${types}&episodeLength=0`, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) })
      .then(async (response) => response.status === 404 ? [] : response.ok ? (await response.json())?.results ?? [] : Promise.reject(new Error('AniSkip is unavailable')))
    // Remember answers, including "none submitted"; forget failures so a later episode visit retries.
    request.catch(() => cache.delete(key))
    cache.set(key, request)
  }
  const results = await request
  if (signal.aborted) return []
  return skipSegments(results, duration)
}
