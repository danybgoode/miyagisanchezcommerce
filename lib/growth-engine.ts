/**
 * lib/growth-engine.ts
 *
 * Forwards events to the golden-beans Growth Engine's ingest endpoint — the Next.js
 * route at `apps/web/app/api/v1/track/route.ts` in that repo, which resolves to the
 * URL path `/api/v1/track` (verified live: `POST <deployment>/api/v1/track` returns
 * 201 against golden-beans' production deployment). Roadmap/01-growth-engine/
 * growth-engine-v1, Sprint 1 · Story 1.3. Mirrors `lib/telegram.ts`'s shape exactly:
 * fire-and-forget, never throws, never blocks the request path, silently skips when
 * unconfigured — safe to call even before GROWTH_ENGINE_URL/GROWTH_ENGINE_API_KEY
 * are set.
 *
 * Not the `@golden-beans/sdk` package — that's a same-repo (golden-beans monorepo)
 * workspace package; cross-repo npm publishing is explicitly out of scope for Sprint 1
 * (see golden-beans' sprint-1.md). This is a small hand-written client, same shape.
 *
 * Env vars:
 *   GROWTH_ENGINE_URL      — e.g. https://golden-beans-gamma.vercel.app
 *   GROWTH_ENGINE_API_KEY  — this project's per-project API key (golden-beans Story 1.1)
 */
import type { GrowthTrackInput } from './growth-track'

const GROWTH_ENGINE_URL = process.env.GROWTH_ENGINE_URL
const GROWTH_ENGINE_API_KEY = process.env.GROWTH_ENGINE_API_KEY

export async function sendGrowthEvent(input: GrowthTrackInput): Promise<void> {
  await sendGrowthEventWithResult(input)
}

/**
 * Same call, but REPORTS whether golden-beans accepted it.
 *
 * `sendGrowthEvent` above is deliberately blind: setup-guide funnel telemetry is
 * observability, and there is nothing a caller could usefully do about a failure.
 * The merchant-lifecycle emitter (lib/merchant-lifecycle-server.ts) is different —
 * it claims a once-only emission slot BEFORE sending, so it has to know whether to
 * release that slot again. A silently-swallowed failure there would burn the
 * milestone permanently: the claim row would say "already emitted" forever while
 * golden-beans never received anything.
 *
 * Returns false when unconfigured, when the request throws, and on any non-2xx —
 * a 401 from a rotated key or a 400 from a rejected context is exactly the case
 * that must not be mistaken for a delivered event.
 */
export async function sendGrowthEventWithResult(input: GrowthTrackInput): Promise<boolean> {
  if (!GROWTH_ENGINE_URL || !GROWTH_ENGINE_API_KEY) return false // silently skip if not configured

  try {
    const res = await fetch(`${GROWTH_ENGINE_URL}/api/v1/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROWTH_ENGINE_API_KEY}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000), // 5s timeout — never block the request path
    })
    return res.ok
  } catch {
    // Intentionally swallowed — growth telemetry is observability, not critical path
    return false
  }
}
