import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  test('shows US marketplace as unavailable without treating the owned shop as unavailable', () => {
    const market = readPublicSellerMarket({
      market_code: 'us', country_code: 'us', currency_code: 'usd', marketplace_status: 'invitation',
    })
    expect(marketVisibility(market)).toEqual({
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
