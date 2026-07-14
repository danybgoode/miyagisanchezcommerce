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
 * never blocks the UI.
 */
export function pushGrowthEvent(event: string, props?: { featureId?: string; tags?: Record<string, unknown> }): void {
  if (typeof window === 'undefined') return
  fetch('/api/growth/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...props }),
  }).catch(() => {
    // Intentionally swallowed — growth telemetry is observability, not critical path
  })
}
