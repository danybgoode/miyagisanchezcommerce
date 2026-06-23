/**
 * lib/admin/tenant-directory.ts
 *
 * The PURE read-model shaper for the admin tenant directory (`/admin/tenants`,
 * admin-consolidation · Sprint 3). It turns a raw `marketplace_shops` mirror row
 * (+ the resolved paywall flag + a listing count) into one display `TenantRow`,
 * and filters a list by a search query — so the directory and its unit spec share
 * exactly one shaper.
 *
 * READ-MODEL CONTRACT (strict): **Medusa seller IDs are the canonical identity**;
 * `marketplace_shops` fields are display/enrichment only. This module never
 * mutates anything. The mirror is the only enumerable list of tenants, so it is
 * the practical list spine — but each row's identity is its
 * `metadata.medusa_seller_id` (surfaced as `medusaSellerId`); a row without one
 * is an un-imported scraped gem, flagged honestly rather than hidden.
 *
 * PURE + next-free: it imports only the equally-pure `lib/claim` and
 * `lib/domain-entitlement` seams (no `next`, no `db`, no `server-only`), so the
 * Playwright `api` runner can import and unit-test it directly. The async reads
 * live in the server sibling `lib/admin/tenant-directory-server.ts`.
 */

import { isShopClaimed } from '@/lib/claim'
import {
  readDomainGrant,
  deriveDomainEntitlement,
  type DomainEntitlementReason,
} from '@/lib/domain-entitlement'

/** Custom-domain state of a tenant, for the directory at a glance. */
export type TenantDomainStatus = 'none' | 'pending' | 'verified'

/** A shaped, display-ready tenant row. Everything here is READ-ONLY. */
export type TenantRow = {
  /** Canonical Medusa seller id (`sel_…`); null for an un-imported scraped gem. */
  medusaSellerId: string | null
  /** Supabase mirror row id — kept for keys/joins, never shown as identity. */
  shopId: string
  slug: string
  name: string
  claimed: boolean
  /** The custom domain, or null when none is set. */
  customDomain: string | null
  domainStatus: TenantDomainStatus
  /** Entitlement reason from the pure deriver (list-level — no subscription lookup). */
  entitlementReason: DomainEntitlementReason
  entitled: boolean
  /**
   * True when this list-level reason resolved to `none` only because the paywall
   * is on and we deliberately skipped the per-seller subscription lookup — so the
   * shop could actually be entitled via an active subscription. Lets the UI avoid
   * asserting a false "no plan". Always `false` while the paywall is off.
   */
  subscriptionUnchecked: boolean
  listingCount: number
  /** ISO timestamp the mirror row was created. */
  createdAt: string | null
}

/** The raw `marketplace_shops` row fields the shaper reads. */
export type RawTenantRow = {
  id: string
  slug?: string | null
  name?: string | null
  clerk_user_id?: string | null
  custom_domain?: string | null
  custom_domain_verified?: boolean | null
  metadata?: unknown
  created_at?: string | null
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Pull the canonical Medusa seller id off the mirror row's metadata. */
export function medusaSellerIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const id = (metadata as Record<string, unknown>).medusa_seller_id
  return typeof id === 'string' && id !== '' ? id : null
}

function deriveDomainStatus(domain: string | null, verified: boolean): TenantDomainStatus {
  if (!domain) return 'none'
  return verified ? 'verified' : 'pending'
}

/**
 * Shape one raw mirror row into a display row. `ctx.paywallEnabled` is the
 * once-resolved rollout flag; `ctx.listingCount` is the per-shop count the server
 * sibling computed. The entitlement is derived WITHOUT the per-seller
 * subscription lookup (too heavy to fan out across a directory) — so the reason
 * `subscription` never appears here; while the paywall flag is off (today's
 * default) every shop derives `flag_off` and the distinction is moot. Never throws.
 */
export function shapeTenantRow(
  raw: RawTenantRow,
  ctx: { paywallEnabled: boolean; listingCount: number },
): TenantRow {
  const customDomain = trimmed(raw.custom_domain) || null
  const entitlement = deriveDomainEntitlement({
    paywallEnabled: ctx.paywallEnabled,
    grant: readDomainGrant(raw.metadata),
  })
  return {
    medusaSellerId: medusaSellerIdOf(raw.metadata),
    shopId: raw.id,
    slug: trimmed(raw.slug),
    name: trimmed(raw.name) || trimmed(raw.slug) || '(sin nombre)',
    claimed: isShopClaimed({ clerk_user_id: raw.clerk_user_id }),
    customDomain,
    domainStatus: deriveDomainStatus(customDomain, !!raw.custom_domain_verified),
    entitlementReason: entitlement.reason,
    entitled: entitlement.entitled,
    subscriptionUnchecked: ctx.paywallEnabled && entitlement.reason === 'none',
    listingCount: Math.max(0, Math.floor(ctx.listingCount) || 0),
    createdAt: trimmed(raw.created_at) || null,
  }
}

/**
 * Filter rows by a free-text query — case-insensitive, trimmed, matching across
 * name, slug, custom domain, and the canonical Medusa seller id. An empty query
 * returns every row. Pure (no side effects).
 */
export function filterTenants(rows: TenantRow[], query: string): TenantRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => {
    const haystack = [row.name, row.slug, row.customDomain ?? '', row.medusaSellerId ?? '']
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

/** es-MX label for an entitlement reason. */
export function entitlementReasonLabel(reason: DomainEntitlementReason): string {
  switch (reason) {
    case 'flag_off':
      return 'Sin restricción (paywall apagado)'
    case 'grandfathered':
      return 'Heredado'
    case 'comp':
      return 'Cortesía'
    case 'subscription':
      return 'Suscripción activa'
    case 'none':
      return 'Sin plan'
  }
}

/** es-MX label for claim status. */
export function claimStatusLabel(claimed: boolean): string {
  return claimed ? 'Reclamada' : 'Sin reclamar'
}

/** es-MX label for custom-domain status. */
export function domainStatusLabel(status: TenantDomainStatus): string {
  switch (status) {
    case 'none':
      return 'Sin dominio'
    case 'pending':
      return 'Pendiente'
    case 'verified':
      return 'Verificado'
  }
}
