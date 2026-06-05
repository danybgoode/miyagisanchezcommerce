import { test, expect } from '@playwright/test'
import { checkoutHopHref, signInHopHref, currentCustomDomain } from '../lib/checkout-hop'

/**
 * Custom-domain checkout hop (epic 07 · custom-domain-checkout, sprint 1).
 *
 * On a tenant custom domain a buyer can't sign in / pay (Clerk is platform-only),
 * so the buy + sign-in CTAs hop to the platform carrying `origin=<domain>`. On the
 * platform these helpers MUST be no-ops (unchanged relative paths) — otherwise we'd
 * break every marketplace buyer with absolute/origin links.
 *
 * Pure-logic test: the hop is driven by the custom-domain header, which a Vercel
 * preview (a platform host) can't present, so the rendered positive path is Daniel's
 * live-domain smoke. This locks the URL-building contract both ways.
 */

test.describe('Checkout hop — URL building', () => {
  test('is a no-op on the platform (relative paths, no origin)', () => {
    expect(checkoutHopHref('/checkout?listingId=abc', null)).toBe('/checkout?listingId=abc')
    expect(signInHopHref('/checkout?listingId=abc', null)).toBe(
      '/sign-in?redirect_url=' + encodeURIComponent('/checkout?listingId=abc'),
    )
    expect(currentCustomDomain('miyagisanchez.com')).toBeNull()
    expect(currentCustomDomain('miyagisanchez.com:3001')).toBeNull()
    expect(currentCustomDomain('some-branch.vercel.app')).toBeNull()
    expect(currentCustomDomain(null)).toBeNull()
  })

  test('hops to the platform carrying origin on a custom domain', () => {
    expect(checkoutHopHref('/checkout?listingId=abc', 'mitienda.mx')).toBe(
      'https://miyagisanchez.com/checkout?listingId=abc&origin=mitienda.mx',
    )
    // sign-in itself moves to the platform; the post-login destination carries origin
    expect(signInHopHref('/checkout?listingId=abc', 'mitienda.mx')).toBe(
      'https://miyagisanchez.com/sign-in?redirect_url=' +
        encodeURIComponent('/checkout?listingId=abc&origin=mitienda.mx'),
    )
    expect(currentCustomDomain('mitienda.mx')).toBe('mitienda.mx')
    expect(currentCustomDomain('MiTienda.MX')).toBe('mitienda.mx')
  })
})
