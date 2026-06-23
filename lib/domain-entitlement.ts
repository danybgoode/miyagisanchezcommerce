/**
 * lib/domain-entitlement.ts
 *
 * The PURE entitlement seam for the custom-domain paywall (epic 07 ·
 * custom-domain-paywall, Sprint 1). "Is this shop allowed to connect / change a
 * custom domain?" derived in ONE place, consumed by every domain mutation route
 * AND the connect UI so the rule can never drift between them.
 *
 * Design (locked with Daniel):
 *  - Entitlement is DERIVED, not a parallel boolean flag. The sources are:
 *      1. the rollout flag (off ⇒ everyone ungated — today's free behavior),
 *      2. a durable grant on `marketplace_shops.metadata.custom_domain_grant`
 *         ({ type:'grandfather'|'comp', ... }) — grandfather is stamped at
 *         cutover, comp is hand-granted by Daniel,
 *      3. an active subscription to the custom-domain plan (Sprint 2 wires this;
 *         the input exists here so S2 is a one-line change, undefined in S1).
 *  - The grant is stored DISTINCT from "currently has a domain" so it survives
 *    Sprint 2's lapse logic (a lapsed seller still has `custom_domain` set but
 *    must lose entitlement).
 *
 * This module is PURE + next-free + has zero side-effect imports, so the
 * Playwright `api` runner can import and unit-test it directly. The async
 * composition (reading the flag + the shop row) lives in
 * `lib/domain-entitlement-server.ts`.
 */

export type DomainGrantType = 'grandfather' | 'comp'

export type DomainGrant = {
  type: DomainGrantType
  /** ISO timestamp the grant was issued. */
  granted_at: string
  /** Optional human note (e.g. "cutover", "WC26 partner"). */
  note?: string
}

export type DomainEntitlementReason =
  | 'flag_off'        // paywall not enabled ⇒ ungated (entitled)
  | 'grandfathered'   // durable grandfather grant
  | 'comp'            // durable comp grant
  | 'subscription'    // active paid subscription to the custom-domain plan (S2)
  | 'none'            // paywall on, no grant, no subscription ⇒ NOT entitled

export type DomainEntitlement = {
  entitled: boolean
  reason: DomainEntitlementReason
}

/**
 * Defensively parse `metadata.custom_domain_grant` off a shop's metadata JSONB.
 * Returns null for missing / malformed / unknown-type grants — so a corrupt
 * value can never accidentally grant (or, when the flag is on, deny incorrectly).
 */
export function readDomainGrant(metadata: unknown): DomainGrant | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>).custom_domain_grant
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (g.type !== 'grandfather' && g.type !== 'comp') return null
  if (typeof g.granted_at !== 'string' || g.granted_at === '') return null
  return {
    type: g.type,
    granted_at: g.granted_at,
    ...(typeof g.note === 'string' ? { note: g.note } : {}),
  }
}

/**
 * Build a `comp` grant in the canonical `custom_domain_grant` shape — the ONE
 * place a hand-granted comp is composed, so the admin grant action (epic 09 ·
 * admin-consolidation, S4.1) writes exactly what `readDomainGrant` parses and
 * `deriveDomainEntitlement` honors (never a parallel shape). `granted_at` is an
 * ISO timestamp; a blank/whitespace note is dropped so the field is absent, not
 * empty. Revoke has no builder — it clears the `custom_domain_grant` key.
 */
export function buildCompGrant(opts?: { note?: string; now?: Date }): DomainGrant {
  return {
    type: 'comp',
    granted_at: (opts?.now ?? new Date()).toISOString(),
    ...(opts?.note?.trim() ? { note: opts.note.trim() } : {}),
  }
}

/**
 * Derive entitlement from the resolved inputs. Precedence:
 *   flag off → grandfather → comp → active subscription → none.
 * Never throws.
 */
export function deriveDomainEntitlement(input: {
  paywallEnabled: boolean
  grant: DomainGrant | null
  /** S2: active sub to the custom-domain plan. Undefined/false in S1. */
  hasActiveSubscription?: boolean
}): DomainEntitlement {
  if (!input.paywallEnabled) return { entitled: true, reason: 'flag_off' }
  if (input.grant?.type === 'grandfather') return { entitled: true, reason: 'grandfathered' }
  if (input.grant?.type === 'comp') return { entitled: true, reason: 'comp' }
  if (input.hasActiveSubscription) return { entitled: true, reason: 'subscription' }
  return { entitled: false, reason: 'none' }
}
