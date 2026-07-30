import { expect, test } from '@playwright/test'
import { UnknownMarketError } from '../lib/markets'
import {
  PROCESS_MARKET_ENV,
  resolveMarketplaceChannelId,
  resolveRegionIdForMarket,
  type MarketMedusaEnv,
} from '../lib/market-medusa'

/**
 * `lib/market-medusa.ts` — market → Medusa Region / Sales Channel (epic decisions
 * D0, D2, D5). Pure over an injected env object, so every branch runs here with a
 * plain literal and no `process.env` mutation.
 */

const FULL: MarketMedusaEnv = {
  NEXT_PUBLIC_MEDUSA_MXN_REGION_ID: 'reg_public',
  MEDUSA_MXN_REGION_ID: 'reg_server',
  MEDUSA_SALES_CHANNEL_ID: 'sc_marketplace',
}

test.describe('resolveRegionIdForMarket', () => {
  test('mx prefers the NEXT_PUBLIC_ copy — the browser-inlined one cart.ts shipped with', () => {
    expect(resolveRegionIdForMarket('mx', FULL)).toBe('reg_public')
  })

  test('mx falls back to the bare server var when the NEXT_PUBLIC_ one is unset', () => {
    expect(resolveRegionIdForMarket('mx', { MEDUSA_MXN_REGION_ID: 'reg_server' })).toBe('reg_server')
  })

  test('an EXPLICITLY EMPTY NEXT_PUBLIC_ value wins, exactly as `??` did before the seam', () => {
    // Byte-compatibility with the constant this replaced: `A ?? B ?? ''` treats ''
    // as a value, not as absent. A `||` here would silently change MX behaviour in
    // a misconfigured environment, which is the one thing this PR promises not to.
    expect(resolveRegionIdForMarket('mx', {
      NEXT_PUBLIC_MEDUSA_MXN_REGION_ID: '',
      MEDUSA_MXN_REGION_ID: 'reg_server',
    })).toBe('')
  })

  test('mx with nothing set answers the empty string, not null — the legacy wire value', () => {
    expect(resolveRegionIdForMarket('mx', {})).toBe('')
  })

  test('us answers null — there is NO US Region, and it must not borrow Mexico\'s (D0)', () => {
    expect(resolveRegionIdForMarket('us', FULL)).toBeNull()
    // Even with every Mexico variable populated. This is the fail-closed assertion.
    expect(resolveRegionIdForMarket('US', FULL)).toBeNull()
  })

  test('an unknown market throws instead of resolving anything', () => {
    expect(() => resolveRegionIdForMarket('ca', FULL)).toThrow(UnknownMarketError)
    expect(() => resolveRegionIdForMarket('es-MX', FULL)).toThrow(UnknownMarketError)
    expect(() => resolveRegionIdForMarket(undefined, FULL)).toThrow(UnknownMarketError)
    expect(() => resolveRegionIdForMarket(null, FULL)).toThrow(UnknownMarketError)
  })
})

test.describe('resolveMarketplaceChannelId', () => {
  test('mx resolves the marketplace Sales Channel from its env var', () => {
    expect(resolveMarketplaceChannelId('mx', FULL)).toBe('sc_marketplace')
  })

  test('mx with nothing set answers null — an unresolvable channel is not an empty id', () => {
    expect(resolveMarketplaceChannelId('mx', {})).toBeNull()
  })

  test('us answers null — no US marketplace channel exists (D0)', () => {
    expect(resolveMarketplaceChannelId('us', FULL)).toBeNull()
  })

  test('an unknown market throws', () => {
    expect(() => resolveMarketplaceChannelId('mex', FULL)).toThrow(UnknownMarketError)
  })
})

test.describe('PROCESS_MARKET_ENV', () => {
  test('exposes exactly the three variables the resolvers read, and nothing else', () => {
    // Pinned because this object exists to keep Next\'s NEXT_PUBLIC_ inlining
    // working (literal member access); a wildcard spread would silently break it.
    expect(Object.keys(PROCESS_MARKET_ENV).sort()).toEqual([
      'MEDUSA_MXN_REGION_ID',
      'MEDUSA_SALES_CHANNEL_ID',
      'NEXT_PUBLIC_MEDUSA_MXN_REGION_ID',
    ])
  })

  test('resolving through it never throws for a supported market', () => {
    expect(() => resolveRegionIdForMarket('mx', PROCESS_MARKET_ENV)).not.toThrow()
    expect(resolveRegionIdForMarket('us', PROCESS_MARKET_ENV)).toBeNull()
  })
})
