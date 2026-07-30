/**
 * lib/market-recommendation.ts — turn a browser locale into a market SUGGESTION.
 *
 * A suggestion, and nothing stronger. Epic 07 · market-architecture-foundation,
 * Story 2.1: browser language or IP may recommend, but must never silently or
 * permanently redirect. Keeping the mapping in its own pure module (rather than
 * inside the client island that renders the badge) is what lets the rule be
 * spec-pinned without a browser.
 *
 * Note what is read and what is ignored: only the REGION subtag, because it is
 * the only part of a BCP-47 tag that carries a country. The language subtag
 * cannot stand in for one — `es-US` and `en-MX` are both real, and treating
 * language as a proxy for market is precisely the conflation `lib/markets.ts`
 * exists to prevent (D3: `requireMarket('es-MX')` throws, loudly).
 */

import { normalizeMarketCode, type MarketCode } from './markets'

/**
 * `'es-MX'` → `'mx'`, `'en-US'` → `'us'`, everything else → `null`.
 *
 * `null` for an unsupported or absent region is the whole answer, not a fallback
 * position: most of the world maps to no market we operate in, and the honest
 * response there is to show the selector with no badge rather than to nudge a
 * visitor toward a country they are not in.
 */
export function recommendedMarketForLocale(locale: string | null | undefined): MarketCode | null {
  const region = (locale ?? '').split(/[-_]/)[1]
  if (!region) return null
  return normalizeMarketCode(region)
}
