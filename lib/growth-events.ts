/**
 * lib/growth-events.ts
 *
 * Client-side sibling to `pushAnalyticsEvent` (lib/analytics-events.ts) — fires the
 * SAME moments into the golden-beans Growth Engine (Roadmap/01-growth-engine/
 * growth-engine-v1, Sprint 1 · Story 1.3) via the internal, Clerk-authed
 * `/api/growth/track` route. Deliberately does NOT know about
 * `growth.telemetry_enabled` — the route itself is the single place that flag is
 * checked, so no client code needs to be flag-aware (and the route stays safe to call
 * even before golden-beans exists — it silently skips).
 *
 * Fire-and-forget, same as `pushAnalyticsEvent` / `lib/telegram.ts`: never throws,
 * never blocks the UI. Same `shouldLoadAnalytics` eligibility gate and `dedupeKey`
 * mechanism as `pushAnalyticsEvent` (own localStorage namespace — a user's existing
 * GTM dedupe key predates this feature, so sharing one would silently under-count
 * the growth-engine funnel for anyone who completed a step before this shipped).
 */
import { shouldLoadAnalytics } from './analytics-gating'

const DEDUPE_PREFIX = 'growth_evt_'

export function pushGrowthEvent(
  event: string,
  props?: { featureId?: string; tags?: Record<string, unknown> },
  options?: { dedupeKey?: string },
): void {
  if (typeof window === 'undefined') return
  if (!shouldLoadAnalytics({ hostname: window.location.hostname, pathname: window.location.pathname })) return

  if (options?.dedupeKey) {
    const storageKey = `${DEDUPE_PREFIX}${options.dedupeKey}`
    try {
      if (window.localStorage.getItem(storageKey)) return
      window.localStorage.setItem(storageKey, '1')
    } catch {
      // localStorage blocked (private mode / disabled) — fire anyway, worst
      // case is a duplicate event rather than a silently lost one.
    }
  }

  fetch('/api/growth/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...props }),
  }).catch(() => {
    // Intentionally swallowed — growth telemetry is observability, not critical path
  })
}
