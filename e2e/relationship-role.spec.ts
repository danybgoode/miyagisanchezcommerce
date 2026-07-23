import { test, expect } from '@playwright/test'
import { decideRelationshipRole, type RoleFacts } from '../lib/relationship-role'

/**
 * Founding merchant activation operations · Sprint 2 fix round (PR 304
 * review, C1) — the pure role-decision rule `resolveRelationshipAccess`
 * delegates to. Zero-import (only an erased `import type` reaches back into
 * `lib/relationship-access.ts`), so every branch — especially the NEW
 * steward mirror — is walked with no database, no Clerk, no Next.
 *
 * C1's fix in one sentence: the assigned STEWARD gets `manager` access, so
 * reassigning ownership doesn't strand the new owner outside the record they
 * were just handed — see `lib/relationship-access.ts`'s doc comment for the
 * full "why the read side, not an auto-grant" reasoning.
 */

const none: RoleFacts = { isAdmin: false, isPromoterOwner: false, isSteward: false, grantRole: null }

test.describe('decideRelationshipRole — precedence: admin > owner > steward (C1) > grant > nothing', () => {
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

  test('C1: steward outranks a STALE viewer grant on the same relationship — the current stewardship wins, not a grant that predates the reassignment', () => {
    expect(decideRelationshipRole({ ...none, isSteward: true, grantRole: 'viewer' })).toBe('manager')
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
})
