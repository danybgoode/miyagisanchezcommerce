/**
 * lib/relationship-role.ts
 *
 * Founding merchant activation operations · Sprint 2 fix round (C1, PR 304
 * review) — the pure ROLE-DECISION rule `resolveRelationshipAccess` calls.
 * Extracted so an `api` spec can walk every branch (especially the steward
 * mirror, C1's fix, and its D1 floor below) without a database, Clerk, or
 * Next — same convention as `lib/merchant-identity.ts#decideDedupeMatch` and
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
   *  `null` when no active grant applies. UNLIKE the original C1 cut, the
   *  caller (`resolveRelationshipAccess`) must now resolve this whenever
   *  `isSteward` might be true too — D1 needs to see it to floor the
   *  steward, so the grant lookup can no longer be skipped just because
   *  stewardship already looks decisive. */
  grantRole: 'manager' | 'viewer' | null
}

/**
 * Precedence: admin > promoter-owner > steward-UNLESS-explicitly-floored
 * (D1) > `partner_grants` role > nothing (`null` — the caller maps that to
 * FORBIDDEN).
 *
 * D1 fix (PR 304 review, round 3 — reverses this module's original C1
 * precedence call, which was wrong): an explicit `viewer` grant FLOORS the
 * steward at `viewer`, rather than the steward outranking it. The original
 * reasoning ("a grant can predate a reassignment and go stale; stewardship
 * is the more current signal") inverted `Roadmap/LEARNINGS.md`'s own rule
 * ("deliberate human decisions win") even while HONORING its letter (no row
 * written to `partner_grants`): a `viewer` grant is not a stale leftover, it
 * is a DELIBERATE "this person may read, not write" decision an admin or
 * seller made — and it may well be *newer* than the stewardship. Under the
 * original (wrong) precedence, promoter A — who cannot even see
 * `partner_grants` — naming P as steward would silently upgrade P from an
 * explicitly-granted `viewer` to `manager`: able to append interactions,
 * create/complete tasks, edit contact/qualification/objections through the
 * S1 update arm, and reassign the steward onward. That is exactly the
 * escalation LEARNINGS forbids. A `manager` grant is NOT a floor (it can
 * only ever match or exceed what stewardship alone grants), so only
 * `'viewer'` gates the steward branch below.
 */
export function decideRelationshipRole(facts: RoleFacts): RelationshipRole | null {
  if (facts.isAdmin) return 'admin'
  if (facts.isPromoterOwner) return 'owner'
  if (facts.isSteward && facts.grantRole !== 'viewer') return 'manager'
  if (facts.grantRole === 'manager') return 'manager'
  if (facts.grantRole === 'viewer') return 'viewer'
  return null
}
