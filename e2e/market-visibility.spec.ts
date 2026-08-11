import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARKETS } from '../lib/markets'
import { marketVisibility } from '../lib/market-visibility'
import { readPublicSellerMarket } from '../lib/owned-market'

const ROOT = join(import.meta.dirname, '..')

test.describe('market visibility', () => {
  test('distinguishes an active owned shop from MX marketplace publication', () => {
    const market = readPublicSellerMarket({
      market_code: 'mx', country_code: 'mx', currency_code: 'mxn', marketplace_status: 'active',
    })
    expect(marketVisibility(market)).toEqual({
      operatingMarketCode: 'mx',
      operatingMarketLabel: 'Tienda propia activa · MX',
      marketplacePublicationLabel: 'Marketplace MX',
    })
  })

  test('shows the US marketplace as published now that the US market is active', () => {
    const market = readPublicSellerMarket({
      market_code: 'us', country_code: 'us', currency_code: 'usd', marketplace_status: 'active',
    })
    expect(marketVisibility(market)).toEqual({
      operatingMarketCode: 'us',
      operatingMarketLabel: 'Tienda propia activa · US',
      marketplacePublicationLabel: 'Marketplace US',
    })
  })

  // Both registered markets are active, so no `readPublicSellerMarket` output can carry a
  // non-active status today. The unavailable branch is still the honest answer for the next
  // market to be registered, so it is exercised directly — a branch no spec can reach is a
  // branch that rots. Delete this only when the label stops depending on marketplace_status.
  test('still labels a not-yet-open marketplace unavailable while its owned shop stays active', () => {
    expect(marketVisibility({
      market: { ...MARKETS.us, marketplace_status: 'invitation' },
      market_code: 'us',
      country_code: 'us',
      currency_code: 'usd',
      marketplace_status: 'invitation',
    })).toEqual({
      operatingMarketCode: 'us',
      operatingMarketLabel: 'Tienda propia activa · US',
      marketplacePublicationLabel: 'Marketplace US no disponible',
    })
  })

  test('does not infer MX when the public seller projection is unreadable', () => {
    expect(marketVisibility(null)).toEqual({
      operatingMarketCode: null,
      operatingMarketLabel: 'Mercado operativo no disponible',
      marketplacePublicationLabel: 'Estado de marketplace no disponible',
    })
  })

  test('does not issue a public-seller lookup for a partner shop without a slug', () => {
    const source = readFileSync(join(ROOT, 'app/(shell)/partner/page.tsx'), 'utf8')
    expect(source).toContain('shop.slug ? await getShop(shop.slug) : null')
  })
})
