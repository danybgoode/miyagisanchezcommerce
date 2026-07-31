import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      market_code: 'us', country_code: 'us', currency_code: 'usd', marketplace_status: 'invitation',
    })

    expect(agentMarketplacePublicationBlock(mx)).toBeNull()
    expect(agentMarketplacePublicationBlock(us)).toContain('marketplace de US aún no está disponible')
    expect(agentMarketplacePublicationBlock(us)).toContain('Tu tienda propia sigue activa')
    expect(agentMarketplacePublicationBlock(null)).toContain('no pudimos verificar el mercado operativo')
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
