import { test, expect } from '@playwright/test'
import { claimLinkAvailability, claimLinkPreviewUrl, claimLinkRegistrationEmail, selectClaimLinkShops } from '../lib/admin/claim-link-directory'
import type { TenantRow } from '../lib/admin/tenant-directory'

const base: TenantRow = {
  medusaSellerId: 'sel_1', shopId: 'shop_1', slug: 'terrumaco', name: 'Terrumaco',
  claimed: false, publicSellerClaimed: false, publicSellerId: 'sel_1', publicSellerVerified: true,
  customDomain: null, domainStatus: 'none',
  entitlementReason: 'flag_off', entitled: true, subscriptionUnchecked: false,
  listingCount: 5, operatingMarketCode: 'mx', operatingMarketLabel: 'México',
  marketplacePublicationLabel: 'Publicada', createdAt: '2026-01-01T00:00:00.000Z',
  status: 'active', registrationEmail: null,
}

test('only an active, verified, unclaimed seller with a market is ready', () => {
  expect(claimLinkAvailability(base)).toEqual({ ready: true })
  for (const patch of [
    { publicSellerClaimed: true }, { publicSellerClaimed: null }, { medusaSellerId: null },
    { publicSellerId: 'sel_other' }, { slug: '' }, { status: 'paused' },
    { publicSellerVerified: false }, { publicSellerVerified: null }, { operatingMarketCode: null },
  ] as Partial<TenantRow>[]) {
    expect(claimLinkAvailability({ ...base, ...patch }).ready).toBe(false)
  }
})

test('a held or unreadable merchant preview never produces a public shop link', () => {
  expect(claimLinkPreviewUrl('mx', 'terrumaco', false)).toBeNull()
  expect(claimLinkPreviewUrl('mx', 'terrumaco', null, 'https://miyagisanchez.com')).toBeNull()
  expect(claimLinkPreviewUrl('mx', 'terrumaco', true)).toBe('/mx/s/terrumaco')
  expect(claimLinkPreviewUrl('mx', 'terrumaco', true, 'https://miyagisanchez.com'))
    .toBe('https://miyagisanchez.com/mx/s/terrumaco')
})

test('unclaimed view includes unavailable shops, ready view narrows them, all view shows claimed', () => {
  const rows = [
    base,
    { ...base, shopId: 'shop_2', slug: 'unverified', name: 'Unverified', publicSellerVerified: false },
    { ...base, shopId: 'shop_3', slug: 'claimed', name: 'Claimed', publicSellerClaimed: true },
  ]
  const sort = { key: 'name' as const, direction: 'asc' as const }
  expect(selectClaimLinkShops(rows, 'unclaimed', {}, sort).map(row => row.shopId)).toEqual(['shop_1', 'shop_2'])
  expect(selectClaimLinkShops(rows, 'ready', {}, sort).map(row => row.shopId)).toEqual(['shop_1'])
  expect(selectClaimLinkShops(rows, 'all', {}, sort)).toHaveLength(3)
  expect(selectClaimLinkShops(rows, 'all', { q: 'terrumaco' }, sort)).toHaveLength(1)
})

test('a stale mirror cannot make a claimed Medusa seller look ready', () => {
  const staleMirror = { ...base, claimed: false, publicSellerClaimed: true }
  expect(claimLinkAvailability(staleMirror)).toEqual({ ready: false, reason: 'Ya reclamada' })
  expect(selectClaimLinkShops([staleMirror], 'unclaimed', {}, { key: 'name', direction: 'asc' })).toEqual([])
})

test('a slug resolving to another seller is flagged for repair', () => {
  expect(claimLinkAvailability({ ...base, publicSellerId: 'sel_other' }))
    .toEqual({ ready: false, reason: 'Identidad de vendedor inconsistente' })
})

test('a stale mirror email is never shown for an unclaimed or unreadable Medusa seller', () => {
  const oldEmail = { ...base, claimed: true, registrationEmail: 'old-owner@example.com' }
  expect(claimLinkRegistrationEmail(oldEmail)).toBe('Sin reclamar')
  expect(claimLinkRegistrationEmail({ ...oldEmail, publicSellerClaimed: null })).toBe('No disponible')
  expect(claimLinkRegistrationEmail({ ...oldEmail, publicSellerClaimed: true })).toBe('old-owner@example.com')
})
