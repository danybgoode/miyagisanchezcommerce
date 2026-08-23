import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  publicShopPaymentAvailability,
  type PublicShopMetadata,
  type PublicStripeProjection,
  type PublicTransferProjection,
} from '../lib/public-shop-commerce'
import type { EmbedShop } from '../lib/embed-auth'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test.describe('privacy-safe public shop commerce projection', () => {
  test('derives every public payment rail from booleans only', () => {
    const metadata: PublicShopMetadata = {
      mp_enabled: true,
      settings: {
        stripe: { connected: true, enabled: true, charges_enabled: true },
        mercadopago: { connected: true, enabled: true },
        checkout: {
          bank_transfer: { enabled: true, configured: true },
          dimo: { enabled: true, configured: true },
        },
      },
    }
    expect(publicShopPaymentAvailability(metadata)).toEqual({
      stripe: true,
      mercadopago: true,
      bankTransfer: true,
      dimo: true,
    })
  })

  test('legacy private values cannot imply public availability', () => {
    const legacy = {
      mp_enabled: true,
      settings: {
        stripe: { account_id: 'acct_private', charges_enabled: true },
        checkout: {
          bank_transfer: {
            clabe: '012345678901234567',
            bank_name: 'Private bank',
            account_holder: 'Private holder',
          },
          dimo: { phone: '5512345678' },
        },
      },
    }
    expect(publicShopPaymentAvailability(legacy)).toEqual({
      stripe: false,
      mercadopago: false,
      bankTransfer: false,
      dimo: false,
    })
  })

  test('connected/configured rails still respect explicit seller disablement', () => {
    expect(publicShopPaymentAvailability({
      mp_enabled: false,
      settings: {
        stripe: { connected: true, charges_enabled: true, enabled: false },
        mercadopago: { connected: true },
        checkout: {
          bank_transfer: { configured: true, enabled: false },
          dimo: { configured: true, enabled: false },
        },
      },
    })).toEqual({
      stripe: false,
      mercadopago: false,
      bankTransfer: false,
      dimo: false,
    })
  })

  test('Mercado Pago ignores the stale nested enabled flag but honors the platform opt-out', () => {
    expect(publicShopPaymentAvailability({
      mp_enabled: true,
      settings: {
        mercadopago: { connected: true, enabled: false },
      },
    }).mercadopago).toBe(true)

    expect(publicShopPaymentAvailability({
      mp_enabled: false,
      settings: {
        mercadopago: { connected: true, enabled: false },
      },
    }).mercadopago).toBe(false)
  })

  test('optional enabled flags preserve each rail’s backend activation rule', () => {
    expect(publicShopPaymentAvailability({
      settings: {
        checkout: {
          bank_transfer: { configured: true },
          dimo: { configured: true },
        },
      },
    })).toMatchObject({
      bankTransfer: true,
      dimo: false,
    })
  })

  test('the public TypeScript projections have no private-coordinate keys', () => {
    type Assert<T extends true> = T
    const stripeKeysArePublic: Assert<'account_id' extends keyof PublicStripeProjection ? false : true> = true
    const transferKeysArePublic: Assert<
      Extract<'clabe' | 'bank_name' | 'account_holder' | 'phone', keyof PublicTransferProjection> extends never
        ? true
        : false
    > = true
    const embedHasNoMetadata: Assert<'metadata' extends keyof EmbedShop ? false : true> = true
    expect(stripeKeysArePublic && transferKeysArePublic && embedHasNoMetadata).toBe(true)
  })
})

/**
 * Scope is deliberately PUBLIC Shop/catalog consumers only. Seller settings,
 * protected checkout responses, orders, and admin tools legitimately carry
 * private coordinates and are not part of this population.
 */
const PUBLIC_SHOP_CONSUMERS = [
  'lib/public-shop-commerce.ts',
  'lib/listings.ts',
  'lib/trust-inputs.ts',
  'lib/ucp/schema.ts',
  'lib/embed-auth.ts',
  'app/(shell)/l/[id]/ListingRenderer.tsx',
  'app/(shell)/s/[slug]/ShopRenderer.tsx',
  'app/(shell)/s/[slug]/HeroSection.tsx',
  'app/(shell)/_shop-collection/CollectionPage.tsx',
  'app/(shell)/embed/s/[slug]/page.tsx',
  'app/api/embed/shop/route.ts',
  'app/api/embed/support/route.ts',
  'app/api/embed/support/checkout/route.ts',
] as const

const PRIVATE_INFERENCE = /\b(?:account_id|clabe|bank_name|account_holder)\b|\bdimo\s*\.\s*phone\b/

test.describe('public Shop consumer population guard', () => {
  for (const file of PUBLIC_SHOP_CONSUMERS) {
    test(`${file} never infers availability from private coordinates`, () => {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(source).not.toMatch(PRIVATE_INFERENCE)
    })
  }

  test('every payment-aware public consumer uses the shared boolean seam', () => {
    for (const file of [
      'app/(shell)/l/[id]/ListingRenderer.tsx',
      'app/(shell)/s/[slug]/ShopRenderer.tsx',
      'app/(shell)/_shop-collection/CollectionPage.tsx',
      'lib/trust-inputs.ts',
      'lib/ucp/schema.ts',
      'app/api/ucp/checkout-session/route.ts',
      'app/api/embed/support/route.ts',
      'app/api/embed/support/checkout/route.ts',
    ]) {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(source, file).toContain('publicShopPaymentAvailability')
    }
  })

  test('embed-key lookup cannot return raw metadata; public routes re-resolve the Shop projection', () => {
    const authSource = stripComments(readFileSync(join(ROOT, 'lib/embed-auth.ts'), 'utf8'))
    expect(authSource).toContain(".select('id, slug, name, verified, logo_url')")
    expect(authSource).not.toContain(".select('id, slug, name, verified, logo_url, metadata')")

    for (const file of [
      'app/api/embed/shop/route.ts',
      'app/api/embed/support/route.ts',
      'app/api/embed/support/checkout/route.ts',
    ]) {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(source, file).toContain('await getShop(resolved.slug)')
    }
  })

  test('public UCP checkout discovery reads only bridge IDs plus the sanitized Shop projection', () => {
    const route = stripComments(readFileSync(
      join(ROOT, 'app/api/ucp/checkout-session/route.ts'),
      'utf8',
    ))
    const mirrorSelect = route.match(
      /\.from\('marketplace_listings'\)[\s\S]*?\.select\('([^']+)'\)/,
    )?.[1]

    expect(mirrorSelect).toBe('id, medusa_product_id, shop:marketplace_shops(slug)')
    expect(mirrorSelect).not.toMatch(
      /\b(?:price_cents|currency|listing_type|metadata|attrs|status|manage_inventory|available_quantity|reserved_quantity)\b/,
    )
    expect(route).toContain('await getShop(sellerSlug)')
    expect(route).toContain('publicShopPaymentAvailability(shopMeta)')
    expect(route).not.toMatch(/marketplace_shops\([^)]*\bmetadata\b/)
    expect(route).not.toMatch(/\b(?:sellerHasMpConnected|const\s+stripeSettings|const\s+bankTransfer)\b/)
    expect(route).not.toMatch(/\.\s*(?:account_id|clabe|bank_name|account_holder)\b/)
  })

  test('public UCP and MCP discovery never return manual payment coordinates', () => {
    for (const file of [
      'app/api/ucp/checkout-session/route.ts',
      'app/api/ucp/mcp/route.ts',
    ]) {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(source, file).not.toContain('bank_details')
      expect(source, file).not.toMatch(/\.\s*(?:clabe|bank_name|account_holder)\b/)
    }
  })

  test('get_checkout_options describes safe discovery, not bank-coordinate delivery', () => {
    const mcp = stripComments(readFileSync(join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8'))
    const start = mcp.indexOf("name: 'get_checkout_options'")
    const end = mcp.indexOf("name: 'create_checkout'", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const tool = mcp.slice(start, end)
    expect(tool).not.toContain('SPEI with CLABE')
    expect(tool).toContain('Bank coordinates are intentionally omitted here')
    expect(tool).toContain('after checkout starts')
  })

  test('transactional and protected payment-detail seams remain intact', () => {
    const cart = stripComments(readFileSync(join(ROOT, 'lib/cart.ts'), 'utf8'))
    const order = stripComments(readFileSync(
      join(ROOT, 'app/(shell)/account/orders/[id]/OrderTrackingClient.tsx'),
      'utf8',
    ))
    const subscription = stripComments(readFileSync(
      join(ROOT, 'app/api/subscriptions/spei/route.ts'),
      'utf8',
    ))

    expect(cart).toContain('clabe?: string | null')
    expect(order).toContain('order.manual_payment.spei?.clabe')
    expect(subscription).toContain('clabe: clabe ?? null')
  })
})
