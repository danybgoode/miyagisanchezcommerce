import { expect, test } from '@playwright/test'
import { UnknownMarketError } from '../lib/markets'
import {
  PROCESS_MARKET_ENV,
  resolveMarketplaceChannelId,
  resolvePublishableKeyForMarket,
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
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: 'pk_mx',
  MEDUSA_US_REGION_ID: 'reg_us',
  MEDUSA_US_MARKETPLACE_CHANNEL_ID: 'sc_us_marketplace',
  MEDUSA_US_PUBLISHABLE_KEY: 'pk_us',
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

  test('us resolves only its own Region and never borrows Mexico\'s', () => {
    expect(resolveRegionIdForMarket('us', FULL)).toBe('reg_us')
    expect(resolveRegionIdForMarket('US', FULL)).toBe('reg_us')
    expect(resolveRegionIdForMarket('us', { MEDUSA_MXN_REGION_ID: 'reg_mx' })).toBe('')
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

  test('us resolves only its own marketplace channel', () => {
    expect(resolveMarketplaceChannelId('us', FULL)).toBe('sc_us_marketplace')
    expect(resolveMarketplaceChannelId('us', { MEDUSA_SALES_CHANNEL_ID: 'sc_mx' })).toBeNull()
  })

  test('an unknown market throws', () => {
    expect(() => resolveMarketplaceChannelId('mex', FULL)).toThrow(UnknownMarketError)
  })
})

test.describe('resolvePublishableKeyForMarket', () => {
  test('selects exactly one market-owned key', () => {
    expect(resolvePublishableKeyForMarket('mx', FULL)).toMatchObject({ status: 'resolved', market: 'mx', token: 'pk_mx' })
    expect(resolvePublishableKeyForMarket('us', FULL)).toMatchObject({ status: 'resolved', market: 'us', token: 'pk_us' })
  })

  test('missing US configuration is named and never falls back to MX', () => {
    expect(resolvePublishableKeyForMarket('us', { NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: 'pk_mx' })).toEqual({
      status: 'unconfigured', market: 'us', kind: 'publishable_key_token',
      env_var: 'MEDUSA_US_PUBLISHABLE_KEY',
      reason: 'Market "us" expects a publishable key token but MEDUSA_US_PUBLISHABLE_KEY is unset.',
    })
  })
})

test.describe('PROCESS_MARKET_ENV', () => {
  test('exposes every literal market variable the resolvers read', () => {
    // Pinned because this object exists to keep Next\'s NEXT_PUBLIC_ inlining
    // working (literal member access); a wildcard spread would silently break it.
    expect(Object.keys(PROCESS_MARKET_ENV).sort()).toEqual([
      'MEDUSA_MXN_REGION_ID',
      'MEDUSA_PUBLISHABLE_KEY',
      'MEDUSA_SALES_CHANNEL_ID',
      'MEDUSA_US_MARKETPLACE_CHANNEL_ID',
      'MEDUSA_US_PUBLISHABLE_KEY',
      'MEDUSA_US_REGION_ID',
      'NEXT_PUBLIC_MEDUSA_MXN_REGION_ID',
      'NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY',
    ])
  })

  test('resolving through it never throws for a supported market', () => {
    expect(() => resolveRegionIdForMarket('mx', PROCESS_MARKET_ENV)).not.toThrow()
    expect(() => resolveRegionIdForMarket('us', PROCESS_MARKET_ENV)).not.toThrow()
  })
})
