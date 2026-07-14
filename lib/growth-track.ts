/**
 * lib/growth-track.ts
 *
 * The PURE half of the growth-telemetry forwarding route (golden-beans
 * Roadmap/01-growth-engine/growth-engine-v1, Sprint 1 · Story 1.3) — mirrors
 * `lib/flags-admin.ts`'s split (server/network logic stays out of this file) so the
 * flag-gating decision is unit-testable in the Playwright `api` runner with zero
 * network/DB (`e2e/growth-track.spec.ts`).
 */

export interface GrowthTrackInput {
  userId: string
  event: string
  featureId?: string
  tags?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type GrowthTrackDecision =
  | { forward: true; payload: GrowthTrackInput }
  | { forward: false; reason: 'flag_off' | 'missing_event' }

/**
 * Decide whether an event should forward to golden-beans. Never throws, never
 * touches the network — the caller (the route handler) owns `isEnabled()` and the
 * actual fetch (`lib/growth-engine.ts`).
 */
export function decideGrowthTrack(flagEnabled: boolean, input: GrowthTrackInput): GrowthTrackDecision {
  if (!input.event) return { forward: false, reason: 'missing_event' }
  if (!flagEnabled) return { forward: false, reason: 'flag_off' }
  return { forward: true, payload: input }
}
