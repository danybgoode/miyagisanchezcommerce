import { expect, test } from '@playwright/test'
import {
  parseSellerAcquisitionUtm,
  resolveSellerPersonaRoute,
  sellerPersonaCtaHref,
  sellerPersonaRouterHref,
} from '../lib/seller-acquisition'

test.describe('seller acquisition · persona config and attribution seam', () => {
  test('resolves live persona routes without touching middleware', () => {
    expect(resolveSellerPersonaRoute('vende')).toMatchObject({
      pagePath: '/vende',
      from: 'vende',
      status: 'live',
    })
    expect(resolveSellerPersonaRoute('creadores')).toMatchObject({
      pagePath: '/vende/creadores',
      from: 'creadores',
      status: 'live',
    })
    expect(resolveSellerPersonaRoute('mundial')).toMatchObject({
      pagePath: '/vende/mundial',
      from: 'mundial',
      type: 'service',
      status: 'live',
    })
    expect(resolveSellerPersonaRoute('negocios')).toMatchObject({
      pagePath: '/vende/negocios',
      from: 'negocios',
      status: 'live',
    })
  })

  test('builds CTA hrefs with persona from-param and safe UTM carry-through', () => {
    const href = sellerPersonaCtaHref('creadores', {
      utm_source: 'instagram',
      utm_medium: 'bio ',
      utm_campaign: ' creator-drop ',
      ref: 'not-carried',
    })

    expect(href).toBe('/sell?from=creadores&utm_source=instagram&utm_medium=bio&utm_campaign=creator-drop')
  })

  test('keeps World Cup service type on the shipped wedge CTA', () => {
    expect(sellerPersonaCtaHref('mundial', 'utm_source=qr')).toBe(
      '/sell?type=service&from=mundial&utm_source=qr',
    )
  })

  test('routes the local business persona to its page with attribution', () => {
    expect(sellerPersonaRouterHref('negocios', 'utm_source=flyer')).toBe(
      '/vende/negocios?utm_source=flyer',
    )
    expect(sellerPersonaCtaHref('negocios', 'utm_source=flyer')).toBe(
      '/sell?from=negocios&utm_source=flyer',
    )
  })

  test('routes backlog personas to the anchor onboarding with attribution', () => {
    expect(sellerPersonaRouterHref('servicios', 'utm_source=flyer')).toBe(
      '/sell?from=vende&utm_source=flyer',
    )
  })

  test('sanitizes empty, unknown, and overlong UTM values', () => {
    const longValue = 'x'.repeat(160)
    expect(parseSellerAcquisitionUtm({
      utm_source: ' ',
      utm_medium: longValue,
      foo: 'bar',
    })).toEqual({
      utm_medium: longValue.slice(0, 140),
    })
  })
})
