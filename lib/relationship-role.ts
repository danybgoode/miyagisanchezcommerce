/**
 * lib/relationship-role.ts
 *
 * Founding merchant activation operations · Sprint 2 fix round (C1, PR 304
 * review) — the pure ROLE-DECISION rule `resolveRelationshipAccess` calls.
 * Extracted so an `api` spec can walk every branch (especially the new
 * steward mirror, C1's fix) without a database, Clerk, or Next — same
 * convention as `lib/merchant-identity.ts#decideDedupeMatch` and
 * `lib/relationship-consent.ts#consentSatisfiesEvidence`: the DB-touching
 * caller resolves facts, this file owns only the DECISION over them.
 *
 * ONLY a `import type` reaches back into `lib/relationship-access.ts` (erased
 * at compile time, pulls in none of its runtime imports — 'server-only',
 * Clerk, Supabase) — this file itself imports nothing.
 */
import type { RelationshipRole } from './relationship-access'

export interface RoleFacts {
  isAdmin: boolean
  /** `actor.promoterId` is set AND equals the row's `promoter_id`. */
  isPromoterOwner: boolean
  /** C1: the row's `steward_clerk_user_id` is non-null AND equals the
   *  caller's OWN Clerk id. Never true for a null steward — an unset
   *  steward must never accidentally match an unset caller id. */
  isSteward: boolean
  /** The caller's `partner_grants` role for this relationship's shop, or
   *  `null` when no active grant applies (or none was looked up because an
   *  earlier, higher-precedence fact already decided the role). */
  grantRole: 'manager' | 'viewer' | null
}

/**
 * Precedence: admin > promoter-owner > steward (C1) > `partner_grants` role
 * > nothing (`null` — the caller maps that to FORBIDDEN).
 *
 * Steward is checked BEFORE the grant so a steward who happens to ALSO hold
 * an unrelated `viewer` grant on the same shop still gets `manager` — the
 * CURRENT stewardship is the more specific, more recent signal (a grant can
 * predate a reassignment and stay stale; `steward_clerk_user_id` is exactly
 * what the owner-reassign route just wrote).
 */
export function decideRelationshipRole(facts: RoleFacts): RelationshipRole | null {
  if (facts.isAdmin) return 'admin'
  if (facts.isPromoterOwner) return 'owner'
  if (facts.isSteward) return 'manager'
  if (facts.grantRole === 'manager') return 'manager'
  if (facts.grantRole === 'viewer') return 'viewer'
  return null
}
