import { expect, test } from '@playwright/test'
import { pageAfterAdminListChange, paginate } from '../lib/admin-pagination'
import { selectTenants, type TenantRow } from '../lib/admin/tenant-directory'
import { COMMUNICATION_CATALOG, filterCommunications } from '../lib/notifications/catalog'

function tenant(index: number, overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    medusaSellerId: `sel_${index}`,
    shopId: `shop_${index}`,
    slug: `tienda-${index}`,
    name: `Tienda ${String(index).padStart(2, '0')}`,
    claimed: true,
    customDomain: null,
    domainStatus: 'none',
    entitlementReason: 'flag_off',
    entitled: true,
    subscriptionUnchecked: false,
    listingCount: index,
    operatingMarketCode: 'mx',
    operatingMarketLabel: 'México',
    marketplacePublicationLabel: 'Publicada',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    registrationEmail: `shop-${index}@example.com`,
    ...overrides,
  }
}

test.describe('admin list pagination', () => {
  test('slices a filtered tenant set completely and without overlapping rows', () => {
    const filtered = selectTenants(Array.from({ length: 53 }, (_, index) => tenant(index)), { q: 'tienda' })
    const firstPage = paginate(filtered, 1, 25)
    const served = Array.from({ length: firstPage.totalPages }, (_, index) => paginate(filtered, index + 1, 25).pageItems)
    const servedIds = served.flatMap((rows) => rows.map((row) => row.shopId))

    expect(servedIds).toEqual(filtered.map((row) => row.shopId))
    expect(new Set(servedIds).size).toBe(filtered.length)
  })

  test('clamps a page beyond a filtered communications result instead of serving an empty page', () => {
    const filtered = filterCommunications(COMMUNICATION_CATALOG, { to: 'seller' })
    const result = paginate(filtered, 99, 25)

    expect(result.page).toBe(result.totalPages)
    expect(result.pageItems).not.toEqual([])
  })

  test('a filter or sort change resets the resulting page number to one', () => {
    const filtered = selectTenants(
      Array.from({ length: 30 }, (_, index) => tenant(index, { status: index < 4 ? 'paused' : 'active' })),
      { status: 'paused' },
    )
    const page = pageAfterAdminListChange(3, true)
    const result = paginate(filtered, page, 25)

    expect(page).toBe(1)
    expect(result.page).toBe(page)
  })
})
