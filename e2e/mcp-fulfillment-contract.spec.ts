import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

test.describe('MCP fulfillment checkout contract', () => {
  test('tools advertise discovery + selection without any caller-owned money fields', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    const getDefinition = source.slice(
      source.indexOf("name: 'get_checkout_options'"),
      source.indexOf("name: 'create_checkout'"),
    )
    const createDefinition = source.slice(
      source.indexOf("name: 'create_checkout'"),
      source.indexOf("name: 'get_support_options'"),
    )

    expect(getDefinition).toContain('shipping_destination: SHIPPING_DESTINATION_SCHEMA')
    expect(createDefinition).toContain('fulfillment_method_id')
    expect(createDefinition).toContain('fulfillment_destination_id')
    expect(createDefinition).toContain('fulfillment_option_id')
    expect(createDefinition).toContain('pickup_appointment: PICKUP_APPOINTMENT_SCHEMA')
    expect(createDefinition).not.toMatch(/shipping_(amount|carrier|service|currency)/)
    expect(source).toContain('fulfillment_option_id: ${option.id')
    expect(source).toContain('fulfillment_destination_id: ${destination.id')
  })

  test('selection is freshly resolved before the cart write and the legacy no-selection path remains', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    const handler = source.slice(
      source.indexOf('async function handleCreateCheckout('),
      source.indexOf('async function handleCreateConfiguredCheckout('),
    )
    const freshCatalog = handler.indexOf('fetchBackendCheckoutOptions({')
    const freshRates = handler.indexOf('fetchBackendShippingRates({ listingId')
    const resolver = handler.indexOf('resolveUcpFulfillmentSelection({')
    const cartWrite = handler.indexOf('const result = await startCheckout({')
    const legacyGateway = handler.indexOf('const endpoint = method ===')

    expect(freshCatalog).toBeGreaterThan(-1)
    expect(freshRates).toBeGreaterThan(freshCatalog)
    expect(resolver).toBeGreaterThan(freshRates)
    expect(cartWrite).toBeGreaterThan(resolver)
    expect(legacyGateway).toBeGreaterThan(cartWrite)
    expect(handler).toContain('if (resolvedFulfillment)')
    expect(handler).toContain('...resolvedFulfillment')
    expect(handler).not.toContain('args.amount')
    expect(handler).not.toContain('args.currency')
    expect(handler).not.toContain('args.carrier')
    expect(handler).not.toContain('args.service')
    expect(handler).toContain('marketSession.delivery?.arranged === true')
  })

  test('checkout-session projects only the UCP fulfillment shape from backend sources', () => {
    const source = readFileSync(join(ROOT, 'app/api/ucp/checkout-session/route.ts'), 'utf8')
    expect(source).toContain('fetchBackendCheckoutOptions({')
    expect(source).toContain('fetchBackendShippingRates({ listingId: publicListingId')
    expect(source).toContain('projectUcpFulfillment({')
    expect(source).toContain('...(fulfillment ? { fulfillment } : {})')
    expect(source).not.toContain('ucp.checkout_shipping_enabled')
  })
})
