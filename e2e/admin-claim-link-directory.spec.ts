import { test, expect } from '@playwright/test'
import { claimLinkAvailability, selectClaimLinkShops } from '../lib/admin/claim-link-directory'
import type { TenantRow } from '../lib/admin/tenant-directory'

const base: TenantRow = {
  medusaSellerId: 'sel_1', shopId: 'shop_1', slug: 'terrumaco', name: 'Terrumaco',
  claimed: false, publicSellerVerified: true, customDomain: null, domainStatus: 'none',
  entitlementReason: 'flag_off', entitled: true, subscriptionUnchecked: false,
  listingCount: 5, operatingMarketCode: 'mx', operatingMarketLabel: 'México',
  marketplacePublicationLabel: 'Publicada', createdAt: '2026-01-01T00:00:00.000Z',
  status: 'active', registrationEmail: null,
}

test('only an active, verified, unclaimed seller with a market is ready', () => {
  expect(claimLinkAvailability(base)).toEqual({ ready: true })
  for (const patch of [
    { claimed: true }, { medusaSellerId: null }, { slug: '' }, { status: 'paused' },
    { publicSellerVerified: false }, { publicSellerVerified: null }, { operatingMarketCode: null },
  ] as Partial<TenantRow>[]) {
    expect(claimLinkAvailability({ ...base, ...patch }).ready).toBe(false)
  }
})

test('unclaimed view includes unavailable shops, ready view narrows them, all view shows claimed', () => {
  const rows = [
    base,
    { ...base, shopId: 'shop_2', slug: 'unverified', name: 'Unverified', publicSellerVerified: false },
    { ...base, shopId: 'shop_3', slug: 'claimed', name: 'Claimed', claimed: true },
  ]
  const sort = { key: 'name' as const, direction: 'asc' as const }
  expect(selectClaimLinkShops(rows, 'unclaimed', {}, sort).map(row => row.shopId)).toEqual(['shop_1', 'shop_2'])
  expect(selectClaimLinkShops(rows, 'ready', {}, sort).map(row => row.shopId)).toEqual(['shop_1'])
  expect(selectClaimLinkShops(rows, 'all', {}, sort)).toHaveLength(3)
  expect(selectClaimLinkShops(rows, 'all', { q: 'terrumaco' }, sort)).toHaveLength(1)
})
