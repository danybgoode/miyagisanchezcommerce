import { expect, test } from '@playwright/test'
import { MARKETS } from '../lib/markets'
import {
  MARKET_ECHO_FIELD,
  MARKET_QUERY_PARAM,
  isMarketUnavailable,
  marketMetaFor,
  marketMetaUnavailable,
  planMarketCatalogRead,
  readMarketFilterState,
  takeMarketScopedField,
  verifyMarketFilter,
  type MarketCatalogDecision,
  type MarketUnavailable,
} from '../lib/market-catalog'
import { buildQuery } from '../lib/listing-query'

/**
 * DEGRADE CLOSED — the single most important behaviour in the frontend half of the
 * market architecture epic (decisions D14 and D10).
 *
 * The backend ships and deploys before this code does, so there is a window with no
 * server-side market filter. The rule under test: an unknown market, or a market
 * whose marketplace is not open, must return the structured unavailable state and
 * must NEVER produce the unfiltered Mexico catalog.
 */

function plan(market?: unknown): MarketCatalogDecision {
  return planMarketCatalogRead(market)
}

function asUnavailable(decision: MarketCatalogDecision): MarketUnavailable {
  expect(isMarketUnavailable(decision)).toBe(true)
  return decision as MarketUnavailable
}

test.describe('planMarketCatalogRead · refuses BEFORE any I/O', () => {
  test('us is refused with the structured invitation state — never MX rows', () => {
    const state = asUnavailable(plan('us'))
    expect(state).toEqual({
      unavailable: true,
      market_code: 'us',
      marketplace_status: 'invitation',
      reason: 'marketplace_not_open',
    })
  })

  test('the refusal carries no listings, no total, no catalog of any kind', () => {
    // The whole decision object is the answer; there is nowhere for a row to hide.
    const state = asUnavailable(plan('us'))
    expect(Object.keys(state).sort()).toEqual(['market_code', 'marketplace_status', 'reason', 'unavailable'])
  })

  test('an unknown market is refused, and is NOT coerced to Mexico', () => {
    for (const value of ['ca', 'mex', 'mxn', 'es-MX', 'mx-north', 42, {}, ['mx']]) {
      const state = asUnavailable(plan(value))
      expect(state.reason, JSON.stringify(value)).toBe('unknown_market')
      expect(state.market_code, JSON.stringify(value)).toBeNull()
    }
  })

  test('mx is approved and carries the wire contract the backend must match', () => {
    const decision = plan('mx')
    expect(isMarketUnavailable(decision)).toBe(false)
    if (isMarketUnavailable(decision)) return
    expect(decision.market).toEqual(MARKETS.mx)
    expect(decision.query).toBe(`${MARKET_QUERY_PARAM}=mx`)
  })

  test('an un-annotated legacy caller resolves to DEFAULT_MARKET (D5) — MX unchanged', () => {
    for (const value of [undefined, null]) {
      const decision = plan(value)
      expect(isMarketUnavailable(decision)).toBe(false)
      if (!isMarketUnavailable(decision)) expect(decision.market.code).toBe('mx')
    }
  })

  test('case and whitespace normalise; a near-miss still fails closed', () => {
    const ok = plan(' MX ')
    expect(isMarketUnavailable(ok)).toBe(false)
    expect(asUnavailable(plan('m x')).reason).toBe('unknown_market')
  })
})

test.describe('readMarketFilterState · three states, never two', () => {
  test('confirmed — the backend echoed our market back', () => {
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: 'mx', listings: [] }, 'mx')).toBe('confirmed')
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: 'MX' }, 'mx')).toBe('confirmed')
  })

  test('absent — no echo at all is "I could not check", not "there is no filter"', () => {
    expect(readMarketFilterState({ listings: [] }, 'mx')).toBe('absent')
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: null }, 'mx')).toBe('absent')
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: '' }, 'mx')).toBe('absent')
    expect(readMarketFilterState(null, 'mx')).toBe('absent')
    expect(readMarketFilterState('nonsense', 'mx')).toBe('absent')
  })

  test('mismatch — the backend named a DIFFERENT market, or one we cannot parse', () => {
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: 'us' }, 'mx')).toBe('mismatch')
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: 'mx' }, 'us')).toBe('mismatch')
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: 'zz' }, 'mx')).toBe('mismatch')
    expect(readMarketFilterState({ [MARKET_ECHO_FIELD]: 7 }, 'mx')).toBe('mismatch')
  })
})

test.describe('verifyMarketFilter · what may be SERVED', () => {
  test('a confirmed response is served', () => {
    expect(verifyMarketFilter(MARKETS.mx, { [MARKET_ECHO_FIELD]: 'mx' })).toBeNull()
  })

  test('a MISMATCHED response is refused even for the default market', () => {
    const state = verifyMarketFilter(MARKETS.mx, { [MARKET_ECHO_FIELD]: 'us' })
    expect(state?.reason).toBe('market_mismatch')
  })

  test('an ABSENT echo is tolerated for MX only — the whole live population is MX (D0)', () => {
    expect(verifyMarketFilter(MARKETS.mx, { listings: [] })).toBeNull()
  })

  test('an ABSENT echo is REFUSED for any non-default market', () => {
    // `us` is not `active`, so it never reaches this function through the shell —
    // but the rule is asserted on the record directly, because it is what stops the
    // NEXT market to open from shipping ahead of its backend filter.
    const state = verifyMarketFilter(MARKETS.us, { listings: [{ id: 'prod_mx' }] })
    expect(state).toEqual({
      unavailable: true,
      market_code: 'us',
      marketplace_status: 'invitation',
      reason: 'market_filter_unavailable',
    })
  })
})

test.describe('a buyer-supplied query parameter can never choose the market', () => {
  test('buildQuery does not forward a market key', () => {
    // The market of a public catalog read is a property of the ROUTE. If `market`
    // were in buildQuery's allow-list, `/l?market=us` would be a door into another
    // market by URL edit — the population guard's whole premise.
    const qs = buildQuery({ q: 'taza', market: 'us' } as never)
    expect(qs).toContain('q=taza')
    expect(qs).not.toContain('market')
  })
})

test.describe('takeMarketScopedField · a mismatched response yields NO rows', () => {
  /**
   * The regression this pins, in the shape it actually shipped: the curated
   * homepage pool called the market seam and then returned `data.listings` without
   * ever checking the echo, so a `mismatch` response would have rendered another
   * market's products on the highest-traffic surface in the app.
   *
   * The cached wrapper itself (`getCuratedPool` in `lib/listings.ts`) cannot be
   * exercised here — the Playwright `api` runner cannot load `next/cache`, which
   * is why that file's pure logic lives in this module in the first place. What is
   * tested is the decision that governs it, in the one call the fixed code now
   * makes: rows and verdict come out together, and the rows are empty whenever the
   * verdict is unavailable.
   */
  const POOL = { [MARKET_ECHO_FIELD]: 'us', listings: [{ id: 'prod_mx_1' }, { id: 'prod_mx_2' }] }

  test('a mismatched echo returns the fallback, never the payload rows', () => {
    const { value, unavailable } = takeMarketScopedField<Array<{ id: string }>>(MARKETS.mx, POOL, 'listings', [])
    expect(value).toEqual([])
    expect(unavailable?.reason).toBe('market_mismatch')
  })

  test('the rows really are in the payload — the assertion above is not vacuous', () => {
    expect(POOL.listings).toHaveLength(2)
  })

  test('a confirmed echo returns the rows', () => {
    const confirmed = { [MARKET_ECHO_FIELD]: 'mx', listings: [{ id: 'prod_mx_1' }] }
    const { value, unavailable } = takeMarketScopedField<Array<{ id: string }>>(MARKETS.mx, confirmed, 'listings', [])
    expect(value).toEqual([{ id: 'prod_mx_1' }])
    expect(unavailable).toBeNull()
  })

  test('an absent echo returns rows for MX and the fallback for any other market', () => {
    const legacy = { listings: [{ id: 'prod_mx_1' }] }
    expect(takeMarketScopedField(MARKETS.mx, legacy, 'listings', []).value).toEqual([{ id: 'prod_mx_1' }])
    const refused = takeMarketScopedField(MARKETS.us, legacy, 'listings', [])
    expect(refused.value).toEqual([])
    expect(refused.unavailable?.reason).toBe('market_filter_unavailable')
  })

  test('it works for every field a catalog response carries, not just listings', () => {
    const mismatched = { [MARKET_ECHO_FIELD]: 'us', total: 77, facet_pool: [{ marca: 'x' }], listing: { id: 'p' } }
    expect(takeMarketScopedField(MARKETS.mx, mismatched, 'total', 0).value).toBe(0)
    expect(takeMarketScopedField(MARKETS.mx, mismatched, 'facet_pool', null).value).toBeNull()
    expect(takeMarketScopedField(MARKETS.mx, mismatched, 'listing', null).value).toBeNull()
  })

  test('a malformed payload yields the fallback rather than throwing', () => {
    expect(takeMarketScopedField(MARKETS.mx, null, 'listings', []).value).toEqual([])
    expect(takeMarketScopedField(MARKETS.mx, 'not-json', 'listings', []).value).toEqual([])
  })
})

test.describe('the meta helpers keep the two shapes distinguishable', () => {
  test('an approved read reports its market and no unavailable state', () => {
    expect(marketMetaFor(MARKETS.mx)).toEqual({ market_code: 'mx', market_unavailable: null })
  })

  test('a refused read carries the full reason, so a caller cannot mistake it for "none"', () => {
    const state = asUnavailable(plan('us'))
    expect(marketMetaUnavailable(state)).toEqual({ market_code: 'us', market_unavailable: state })
  })
})
