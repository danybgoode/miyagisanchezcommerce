import { expect, test } from '@playwright/test'
import { decideGrowthTrack } from '../lib/growth-track'

/**
 * Pure-seam coverage for the growth-telemetry forwarding decision (golden-beans
 * Roadmap/01-growth-engine/growth-engine-v1, Sprint 1 · Story 1.3). No browser, no
 * network — proves the flag-gating logic `app/api/growth/track/route.ts` composes.
 * The authed 200/202 path runs anonymous in the `api` project (→ 401, see
 * `growth-track-api.spec.ts`), so THIS is where both flag-on and flag-off branches
 * are actually asserted.
 */

const INPUT = { userId: 'user_test123', event: 'setup_guide_viewed', featureId: 'setup_guide' }

test.describe('growth-track · decideGrowthTrack', () => {
  test('flag OFF → never forwards, regardless of a well-formed input', () => {
    const decision = decideGrowthTrack(false, INPUT)
    expect(decision.forward).toBe(false)
    if (!decision.forward) expect(decision.reason).toBe('flag_off')
  })

  test('flag ON + valid event → forwards the exact payload', () => {
    const decision = decideGrowthTrack(true, INPUT)
    expect(decision).toEqual({ forward: true, payload: INPUT })
  })

  test('missing event → never forwards, even with the flag ON', () => {
    const decision = decideGrowthTrack(true, { userId: 'user_test123', event: '' })
    expect(decision.forward).toBe(false)
    if (!decision.forward) expect(decision.reason).toBe('missing_event')
  })
})
