import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARKETS } from '../lib/markets'
import { agentMarketplacePublicationBlock } from '../lib/market-publication'
import { readPublicSellerMarket } from '../lib/owned-market'

const ROOT = join(import.meta.dirname, '..')
const MCP_ROUTE = readFileSync(join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')

function handlerBody(name: string, nextName: string): string {
  const start = MCP_ROUTE.indexOf(`async function ${name}`)
  const end = MCP_ROUTE.indexOf(`async function ${nextName}`, start)
  expect(start, `${name} must remain an MCP handler`).toBeGreaterThanOrEqual(0)
  expect(end, `${name} must have a following handler`).toBeGreaterThan(start)
  return MCP_ROUTE.slice(start, end)
}

test.describe('seller-agent marketplace publication boundary', () => {
  test('allows only an active, verified market to publish', () => {
    const mx = readPublicSellerMarket({
      market_code: 'mx', country_code: 'mx', currency_code: 'mxn', marketplace_status: 'active',
    })
    const us = readPublicSellerMarket({
      market_code: 'us', country_code: 'us', currency_code: 'usd', marketplace_status: 'active',
    })

    // Both registered marketplaces are open, so both publish. The block is derived from
    // marketplace_status rather than a per-market literal, which is why opening US needed
    // no change here — only this fixture, which had pinned the invitation-era registry.
    expect(agentMarketplacePublicationBlock(mx)).toBeNull()
    expect(agentMarketplacePublicationBlock(us)).toBeNull()
    expect(agentMarketplacePublicationBlock(null)).toContain('no pudimos verificar el mercado operativo')
  })

  // The refusal branch is unreachable through readPublicSellerMarket while every registered
  // market is active; exercised directly so the copy and the boundary stay covered.
  test('refuses publication for a market whose marketplace has not opened', () => {
    const closed = agentMarketplacePublicationBlock({
      market: { ...MARKETS.us, marketplace_status: 'invitation' },
      market_code: 'us',
      country_code: 'us',
      currency_code: 'usd',
      marketplace_status: 'invitation',
    })
    expect(closed).toContain('marketplace de US aún no está disponible')
    expect(closed).toContain('Tu tienda propia sigue activa')
  })

  test('refuses create_listing before image ingestion or a product write', () => {
    const body = handlerBody('handleCreateListing', 'handleListMyListings')
    const guard = body.indexOf('refuseMarketplacePublication(shop, \'crear un anuncio\')')
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(guard).toBeLessThan(body.indexOf('ingestImageUrls('))
    expect(guard).toBeLessThan(body.indexOf('createSellerProductViaInternal('))
  })

  test('refuses publication activation before status and campaign writes', () => {
    const campaign = handlerBody('handleActivateCampaign', 'handleCancelCampaign')
    const listing = handlerBody('handleSetListingStatus', 'handleConfigureListingOptions')

    const campaignGuard = campaign.indexOf("refuseMarketplacePublication(agentShop, 'activar una campaña')")
    expect(campaignGuard).toBeGreaterThanOrEqual(0)
    expect(campaignGuard).toBeLessThan(campaign.indexOf('activateCampaign(context, campaignId)'))

    const listingGuard = listing.indexOf("refuseMarketplacePublication(shop, 'activar un anuncio')")
    expect(listingGuard).toBeGreaterThanOrEqual(0)
    expect(listingGuard).toBeLessThan(listing.indexOf('patchSellerProductViaInternal('))
  })
})
