import { expect, test } from '@playwright/test'
import {
  DEFAULT_MARKET,
  MARKETS,
  MARKET_CODES,
  UnknownMarketError,
  getMarket,
  isMarketCode,
  isMarketplaceOpen,
  looksLikeLocale,
  marketBasePath,
  normalizeMarketCode,
  openMarketCodes,
  requireMarket,
  type MarketRecord,
} from '../lib/markets'

/**
 * THE GOLDEN SPEC for `lib/markets.ts` (epic decision D2).
 *
 * `lib/markets.ts` here and `src/lib/markets.ts` in `apps/backend` are the SAME
 * BYTES in two repositories with no shared package. Nothing mechanical can compare
 * them across the repo boundary, so each side pins every field of every record
 * independently: if one repo's copy drifts, that repo's own gate goes red and the
 * drift is caught at the PR that caused it rather than in production.
 *
 * That is why the table below is written out longhand instead of looping over
 * `MARKETS` — a spec derived from the thing it is testing would pass on any drift.
 * Update it only in the same change that updates BOTH copies of the registry, and
 * say so in the PR body.
 */

const GOLDEN: Record<string, MarketRecord> = {
  mx: {
    code: 'mx',
    country_code: 'mx',
    currency_code: 'mxn',
    default_locale: 'es-MX',
    timezone: 'America/Mexico_City',
    marketplace_status: 'active',
  },
  us: {
    code: 'us',
    country_code: 'us',
    currency_code: 'usd',
    default_locale: 'en-US',
    timezone: 'America/New_York',
    marketplace_status: 'active',
  },
}

test.describe('market registry · golden record contract', () => {
  test('the registry holds exactly the declared market codes, in display order', () => {
    expect([...MARKET_CODES]).toEqual(['mx', 'us'])
    expect(Object.keys(MARKETS).sort()).toEqual(Object.keys(GOLDEN).sort())
  })

  for (const [code, golden] of Object.entries(GOLDEN)) {
    test(`${code} — every field matches the golden record`, () => {
      expect(MARKETS[code as keyof typeof MARKETS]).toEqual(golden)
    })
  }

  test('MX and US are active marketplaces', () => {
    expect(isMarketplaceOpen('mx')).toBe(true)
    expect(isMarketplaceOpen('us')).toBe(true)
    expect(openMarketCodes()).toEqual(['mx', 'us'])
  })

  test('DEFAULT_MARKET is mx — the pre-launch backward-compatible default', () => {
    expect(DEFAULT_MARKET).toBe('mx')
  })

  test('records are frozen — a caller cannot mutate the contract at runtime', () => {
    expect(Object.isFrozen(MARKETS)).toBe(true)
    expect(Object.isFrozen(MARKETS.mx)).toBe(true)
    expect(Object.isFrozen(MARKETS.us)).toBe(true)
  })
})

test.describe('market registry · a locale is never a market (decision D3)', () => {
  // The registry's most important NEGATIVE guarantee. Locale is presentation only;
  // every historical bug in this area started by treating one as the other.
  const LOCALES = ['es-MX', 'en-US', 'es_MX', 'es', 'spa', 'pt-BR']

  for (const locale of LOCALES) {
    test(`${locale} is rejected as a market code`, () => {
      expect(isMarketCode(locale)).toBe(false)
      expect(getMarket(locale)).toBeNull()
      expect(isMarketplaceOpen(locale)).toBe(false)
      expect(() => requireMarket(locale)).toThrow(UnknownMarketError)
    })
  }

  test('the error NAMES the mistake rather than hunting for a missing entry', () => {
    let message = ''
    try { requireMarket('es-MX') } catch (error) { message = (error as Error).message }
    expect(message).toContain('LOCALE')
    expect(message).toContain('presentation')
  })

  test('an unknown NON-locale gets the plain message, not the locale hint', () => {
    let message = ''
    try { requireMarket('ca') } catch (error) { message = (error as Error).message }
    expect(message).toContain('Unsupported market')
    expect(message).not.toContain('LOCALE')
  })

  test('looksLikeLocale only ever upgrades a message — it accepts nothing', () => {
    expect(looksLikeLocale('es-MX')).toBe(true)
    expect(looksLikeLocale('mx')).toBe(false)
    expect(looksLikeLocale(42)).toBe(false)
    expect(looksLikeLocale(null)).toBe(false)
  })
})

test.describe('market registry · isMarketCode is STRICT, so its narrowing is sound', () => {
  /**
   * This spec previously asserted `isMarketCode('MX') === true`. That was faithful
   * to the contract as written — and the contract was wrong. A lenient predicate
   * declared `value is MarketCode` lets `if (isMarketCode(v)) MARKETS[v]`
   * type-check while returning `undefined` at runtime for `'MX'`: a market lookup
   * silently yielding nothing, which is the exact hole the registry exists to
   * close. Caught by the cross-family review, in the architect's own file.
   *
   * Worth recording rather than quietly fixing: a golden spec that faithfully
   * encodes the contract will faithfully encode a BUG in the contract too. The
   * spec did its job; catching this needed a second pair of eyes on the contract
   * itself, which is what the cross-family pass is for.
   */
  test('the canonical form, and ONLY the canonical form', () => {
    expect(isMarketCode('mx')).toBe(true)
    expect(isMarketCode('us')).toBe(true)
  })

  test('a non-canonical spelling is REFUSED — the narrowing must not outrun the lookup', () => {
    for (const value of ['MX', 'Mx', ' us ', 'us\n', ' mx']) {
      expect(isMarketCode(value), JSON.stringify(value)).toBe(false)
    }
  })

  test('every value the predicate accepts is a real key of MARKETS', () => {
    // The soundness property itself, asserted directly rather than by example:
    // if the predicate says yes, the lookup must not return undefined.
    for (const value of ['mx', 'us', 'MX', ' us ', 'mex', 'es-MX', '', 0, null, undefined, {}]) {
      if (isMarketCode(value)) expect(MARKETS[value], JSON.stringify(value)).toBeTruthy()
    }
  })

  test('normalizeMarketCode keeps the leniency and returns the CANONICAL value', () => {
    // Leniency belongs here, where the return value is the tidied string rather
    // than a blessing of the original — so nothing downstream ever carries a
    // non-canonical string typed as a MarketCode.
    expect(normalizeMarketCode('MX')).toBe('mx')
    expect(normalizeMarketCode(' us ')).toBe('us')
    expect(normalizeMarketCode(' US ')).toBe('us')
    expect(normalizeMarketCode('mx')).toBe('mx')
  })

  test('the lenient path still lands on a real record — no ghost codes', () => {
    for (const value of ['MX', ' us ', 'Us']) {
      const code = normalizeMarketCode(value)
      expect(code, JSON.stringify(value)).not.toBeNull()
      expect(MARKETS[code!]).toBeTruthy()
      expect(getMarket(value)).toEqual(MARKETS[code!])
    }
  })

  test('nothing else — a country name, a currency, a padded or suffixed variant', () => {
    for (const value of ['mex', 'mexico', 'mxn', 'usd', 'mx-north', 'm', '', 'us1', 0, null, undefined, {}, ['mx']]) {
      expect(isMarketCode(value), JSON.stringify(value)).toBe(false)
      expect(normalizeMarketCode(value), JSON.stringify(value)).toBeNull()
    }
  })

  test('UnknownMarketError carries the offending value for the log line', () => {
    try {
      requireMarket('mxn')
      throw new Error('requireMarket should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownMarketError)
      expect((error as UnknownMarketError).value).toBe('mxn')
      expect((error as UnknownMarketError).name).toBe('UnknownMarketError')
    }
  })
})

test.describe('market registry · marketBasePath is the only place a market URL shape is stated', () => {
  test('a supported market yields its prefix', () => {
    expect(marketBasePath('mx')).toBe('/mx')
    expect(marketBasePath('US')).toBe('/us')
  })

  test('an unknown market throws rather than producing a plausible-looking path', () => {
    expect(() => marketBasePath('es-MX')).toThrow(UnknownMarketError)
    expect(() => marketBasePath(undefined)).toThrow(UnknownMarketError)
  })
})
