import { test, expect } from '@playwright/test'
import {
  shapeTenantRow,
  filterTenants,
  medusaSellerIdOf,
  entitlementReasonLabel,
  claimStatusLabel,
  domainStatusLabel,
  type RawTenantRow,
  type TenantRow,
} from '../lib/admin/tenant-directory'

/**
 * Admin tenant directory — pure read-model shaper (api gate, no browser). The
 * directory page and this spec share `shapeTenantRow`/`filterTenants`, so the
 * claim/entitlement/domain derivation is covered for free and can't drift.
 */

const base: RawTenantRow = {
  id: 'shop_uuid_1',
  slug: 'la-tienda',
  name: 'La Tienda',
  clerk_user_id: 'user_abc',
  custom_domain: null,
  custom_domain_verified: false,
  metadata: { medusa_seller_id: 'sel_123' },
  created_at: '2026-01-01T00:00:00.000Z',
}

test.describe('admin tenant-directory · shapeTenantRow', () => {
  test('surfaces the canonical Medusa seller id as identity', () => {
    const row = shapeTenantRow(base, { paywallEnabled: false, listingCount: 3 })
    expect(row.medusaSellerId).toBe('sel_123')
    expect(row.shopId).toBe('shop_uuid_1')
    expect(row.listingCount).toBe(3)
  })

  test('flags an un-imported gem (no medusa_seller_id) with null identity', () => {
    const row = shapeTenantRow({ ...base, metadata: { source: 'scraped' } }, { paywallEnabled: false, listingCount: 0 })
    expect(row.medusaSellerId).toBeNull()
  })

  test('claim: real owner → claimed; null and pending: → not claimed', () => {
    expect(shapeTenantRow(base, { paywallEnabled: false, listingCount: 0 }).claimed).toBe(true)
    expect(shapeTenantRow({ ...base, clerk_user_id: null }, { paywallEnabled: false, listingCount: 0 }).claimed).toBe(false)
    expect(shapeTenantRow({ ...base, clerk_user_id: 'pending:tok' }, { paywallEnabled: false, listingCount: 0 }).claimed).toBe(false)
  })

  test('domain status: none / pending (set, unverified) / verified', () => {
    expect(shapeTenantRow(base, { paywallEnabled: false, listingCount: 0 }).domainStatus).toBe('none')
    expect(shapeTenantRow({ ...base, custom_domain: 'shop.mx' }, { paywallEnabled: false, listingCount: 0 }).domainStatus).toBe('pending')
    expect(shapeTenantRow({ ...base, custom_domain: 'shop.mx', custom_domain_verified: true }, { paywallEnabled: false, listingCount: 0 }).domainStatus).toBe('verified')
  })

  test('entitlement: flag off → flag_off & entitled, regardless of grant', () => {
    const row = shapeTenantRow(base, { paywallEnabled: false, listingCount: 0 })
    expect(row.entitlementReason).toBe('flag_off')
    expect(row.entitled).toBe(true)
  })

  test('entitlement: paywall on, no grant → none & not entitled', () => {
    const row = shapeTenantRow(base, { paywallEnabled: true, listingCount: 0 })
    expect(row.entitlementReason).toBe('none')
    expect(row.entitled).toBe(false)
  })

  test('entitlement: paywall on, comp grant → comp & entitled', () => {
    const row = shapeTenantRow(
      { ...base, metadata: { medusa_seller_id: 'sel_1', custom_domain_grant: { type: 'comp', granted_at: '2026-01-01T00:00:00Z' } } },
      { paywallEnabled: true, listingCount: 0 },
    )
    expect(row.entitlementReason).toBe('comp')
    expect(row.entitled).toBe(true)
  })

  test('entitlement: paywall on, grandfather grant → grandfathered & entitled', () => {
    const row = shapeTenantRow(
      { ...base, metadata: { custom_domain_grant: { type: 'grandfather', granted_at: '2026-01-01T00:00:00Z' } } },
      { paywallEnabled: true, listingCount: 0 },
    )
    expect(row.entitlementReason).toBe('grandfathered')
  })

  test('name falls back to slug then a placeholder; listing count is clamped', () => {
    expect(shapeTenantRow({ ...base, name: '  ' }, { paywallEnabled: false, listingCount: 5 }).name).toBe('la-tienda')
    expect(shapeTenantRow({ ...base, name: '', slug: '' }, { paywallEnabled: false, listingCount: 0 }).name).toBe('(sin nombre)')
    expect(shapeTenantRow(base, { paywallEnabled: false, listingCount: -4 }).listingCount).toBe(0)
  })
})

test.describe('admin tenant-directory · medusaSellerIdOf', () => {
  test('reads a string id, ignores empties / non-objects', () => {
    expect(medusaSellerIdOf({ medusa_seller_id: 'sel_9' })).toBe('sel_9')
    expect(medusaSellerIdOf({ medusa_seller_id: '' })).toBeNull()
    expect(medusaSellerIdOf(null)).toBeNull()
    expect(medusaSellerIdOf('nope')).toBeNull()
  })
})

test.describe('admin tenant-directory · filterTenants', () => {
  const rows: TenantRow[] = [
    shapeTenantRow({ ...base, id: 's1', slug: 'cafe-luna', name: 'Café Luna', custom_domain: 'cafeluna.mx', metadata: { medusa_seller_id: 'sel_aaa' } }, { paywallEnabled: false, listingCount: 1 }),
    shapeTenantRow({ ...base, id: 's2', slug: 'tacos-rex', name: 'Tacos Rex', metadata: { medusa_seller_id: 'sel_bbb' } }, { paywallEnabled: false, listingCount: 2 }),
  ]

  test('empty query returns all rows', () => {
    expect(filterTenants(rows, '')).toHaveLength(2)
    expect(filterTenants(rows, '   ')).toHaveLength(2)
  })

  test('matches by name (case-insensitive)', () => {
    expect(filterTenants(rows, 'café').map(r => r.slug)).toEqual(['cafe-luna'])
    expect(filterTenants(rows, 'TACOS').map(r => r.slug)).toEqual(['tacos-rex'])
  })

  test('matches by slug, domain, and Medusa seller id', () => {
    expect(filterTenants(rows, 'rex').map(r => r.slug)).toEqual(['tacos-rex'])
    expect(filterTenants(rows, 'cafeluna.mx').map(r => r.slug)).toEqual(['cafe-luna'])
    expect(filterTenants(rows, 'sel_bbb').map(r => r.slug)).toEqual(['tacos-rex'])
  })

  test('no match returns empty', () => {
    expect(filterTenants(rows, 'zzz-nada')).toHaveLength(0)
  })
})

test.describe('admin tenant-directory · es-MX labels', () => {
  test('entitlement reason labels are Spanish and total', () => {
    for (const reason of ['flag_off', 'grandfathered', 'comp', 'subscription', 'none'] as const) {
      expect(entitlementReasonLabel(reason).length).toBeGreaterThan(0)
    }
  })
  test('claim + domain labels', () => {
    expect(claimStatusLabel(true)).toBe('Reclamada')
    expect(claimStatusLabel(false)).toBe('Sin reclamar')
    expect(domainStatusLabel('verified')).toBe('Verificado')
    expect(domainStatusLabel('none')).toBe('Sin dominio')
  })
})
