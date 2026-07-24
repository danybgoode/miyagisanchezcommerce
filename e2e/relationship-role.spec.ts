import { test, expect } from '@playwright/test'
import { decideRelationshipRole, type RoleFacts } from '../lib/relationship-role'

/**
 * Founding merchant activation operations · Sprint 2 fix round (PR 304
 * review, C1 + D1) — the pure role-decision rule `resolveRelationshipAccess`
 * delegates to. Zero-import (only an erased `import type` reaches back into
 * `lib/relationship-access.ts`), so every branch — especially the steward
 * mirror (C1) and its viewer-grant FLOOR (D1) — is walked with no database,
 * no Clerk, no Next.
 *
 * C1's fix in one sentence: the assigned STEWARD gets `manager` access, so
 * reassigning ownership doesn't strand the new owner outside the record they
 * were just handed.
 *
 * D1 REVERSES the original C1 precedence call (round 3): an explicit
 * `viewer` grant now FLOORS the steward at `viewer`, rather than the
 * steward outranking it — see `lib/relationship-role.ts`'s doc comment for
 * the full "deliberate write-denial outranks an implicit upgrade" reasoning.
 * The test named "steward outranks a STALE viewer grant" below is GONE —
 * that was the wrong behavior this round corrects, not a scenario to keep
 * asserting.
 */

const none: RoleFacts = { isAdmin: false, isPromoterOwner: false, isSteward: false, grantRole: null }

test.describe('decideRelationshipRole — precedence: admin > owner > steward-unless-floored (D1) > grant > nothing', () => {
  test('no fact holds at all → null (FORBIDDEN)', () => {
    expect(decideRelationshipRole(none)).toBeNull()
  })

  test('admin alone → admin, regardless of anything else', () => {
    expect(decideRelationshipRole({ ...none, isAdmin: true })).toBe('admin')
    expect(decideRelationshipRole({ isAdmin: true, isPromoterOwner: true, isSteward: true, grantRole: 'viewer' })).toBe('admin')
  })

  test('promoter-owner alone → owner', () => {
    expect(decideRelationshipRole({ ...none, isPromoterOwner: true })).toBe('owner')
  })

  test('C1: steward alone (no promoter_id ownership, no grant at all) → manager — this is the exact hole C1 closes', () => {
    expect(decideRelationshipRole({ ...none, isSteward: true })).toBe('manager')
  })

  test('steward with NO grant recorded at all (grantRole: null — a shop with no partner_grants row, or the caller has no promoter binding) → manager, same as bare C1', () => {
    expect(decideRelationshipRole({ ...none, isSteward: true, grantRole: null })).toBe('manager')
  })

  test('steward WITH a manager grant → manager either way (a manager grant is never a floor — it can only match or exceed stewardship alone)', () => {
    expect(decideRelationshipRole({ ...none, isSteward: true, grantRole: 'manager' })).toBe('manager')
  })

  test('D1 — THE FIX: steward who ALSO holds an explicit viewer grant → viewer, not manager. This is the exact scenario the wrong C1 precedence would have silently escalated: promoter A (who cannot see partner_grants) names P steward, and P was deliberately floored to viewer by an admin/seller — the floor must survive that.', () => {
    expect(decideRelationshipRole({ ...none, isSteward: true, grantRole: 'viewer' })).toBe('viewer')
  })

  test('a manager grant, no steward, no owner → manager', () => {
    expect(decideRelationshipRole({ ...none, grantRole: 'manager' })).toBe('manager')
  })

  test('a viewer grant, no steward, no owner → viewer (read-only, matches canWriteRelationship denying it)', () => {
    expect(decideRelationshipRole({ ...none, grantRole: 'viewer' })).toBe('viewer')
  })

  test('owner outranks a viewer grant', () => {
    expect(decideRelationshipRole({ ...none, isPromoterOwner: true, grantRole: 'viewer' })).toBe('owner')
  })

  test('owner outranks steward=false + grant=manager (owner already grants everything a manager grant would)', () => {
    expect(decideRelationshipRole({ ...none, isPromoterOwner: true, grantRole: 'manager' })).toBe('owner')
  })

  test('D1 — owner is UNAFFECTED by the viewer floor: an owner who is ALSO the steward AND holds a viewer grant still gets owner, not viewer (owner strictly outranks everything below it)', () => {
    expect(decideRelationshipRole({ ...none, isPromoterOwner: true, isSteward: true, grantRole: 'viewer' })).toBe('owner')
  })
})
