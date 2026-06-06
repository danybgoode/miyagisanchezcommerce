import { test, expect } from '@playwright/test'
import {
  isShortLinkHost, firstSegment, shopTarget, listingTarget,
  HOME_TARGET, NOT_FOUND_TARGET, PLATFORM_ORIGIN,
} from '../lib/shortlink'

/**
 * Short links · US-1. Pure-logic guards on the mschz.org redirector: host match,
 * case-insensitive single-segment parsing, and canonical targets. The DB lookups
 * (shop slug / alias / product code) live in middleware; these are deterministic.
 */
test.describe('shortlink · host + segment', () => {
  test('isShortLinkHost matches mschz.org (+ www, port-tolerant)', () => {
    expect(isShortLinkHost('mschz.org')).toBe(true)
    expect(isShortLinkHost('www.mschz.org')).toBe(true)
    expect(isShortLinkHost('MSCHZ.ORG:443')).toBe(true)
    expect(isShortLinkHost('miyagisanchez.com')).toBe(false)
    expect(isShortLinkHost('shop.miyagisanchez.com')).toBe(false)
    expect(isShortLinkHost(null)).toBe(false)
  })

  test('firstSegment is case-insensitive, decoded, empty→null', () => {
    expect(firstSegment('/Mi-Tienda')).toBe('mi-tienda')
    expect(firstSegment('/mi-tienda/extra/parts')).toBe('mi-tienda')
    expect(firstSegment('/ShopName?x=1'.split('?')[0])).toBe('shopname')
    expect(firstSegment('/')).toBeNull()
    expect(firstSegment('')).toBeNull()
    expect(firstSegment('/caf%C3%A9')).toBe('café')
  })
})

test.describe('shortlink · targets', () => {
  test('shop + listing canonical targets', () => {
    expect(shopTarget('mi-tienda')).toBe(`${PLATFORM_ORIGIN}/s/mi-tienda`)
    expect(listingTarget('prod_01ABC')).toBe(`${PLATFORM_ORIGIN}/l/prod_01ABC`)
  })

  test('home + branded 404 targets', () => {
    expect(HOME_TARGET).toBe('https://miyagisanchez.com')
    expect(NOT_FOUND_TARGET).toBe('https://miyagisanchez.com/404')
  })
})
