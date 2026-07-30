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
  'app/(shell)/l/[id]/page.tsx',
  'app/(shell)/s/[slug]/page.tsx',
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
      'app/(shell)/l/[id]/page.tsx',
      'app/(shell)/s/[slug]/page.tsx',
      'app/(shell)/_shop-collection/CollectionPage.tsx',
      'lib/trust-inputs.ts',
      'lib/ucp/schema.ts',
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
})
