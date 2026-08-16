import { MARKETS, isMarketCode, type MarketCode } from './markets'

/**
 * Which market a new shop should operate in, from the signup entry point.
 *
 * us-marketplace S5.2 (D17). Before this, shop creation carried no market at all, so a
 * merchant who signed up from `/us` got a Mexican shop — pricing in pesos, publishing
 * into the Mexican marketplace — and nothing anywhere told them. The market is
 * immutable after creation (D7), so that first request is the only moment it can be
 * set, and getting it wrong meant a shop that had to be recreated.
 *
 * Three states, not two:
 *   · a real, OPEN market            → that market
 *   · anything else                  → `undefined`, meaning "say nothing"
 *
 * `undefined` is not the same as `'mx'`, and this deliberately does not substitute one
 * for the other. Omitting the field lets the backend apply its documented
 * `legacy_default`; asserting `'mx'` would make this function a second, competing
 * source of that default — and a paraphrased contract drifts (LEARNINGS). One writer,
 * one default, stated in one place.
 */
export function resolveSellerSignupMarket(value: unknown): MarketCode | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!isMarketCode(raw)) return undefined

  // A market that is not open to shops cannot be chosen at signup, whatever the
  // caller asks for. Reading the registry rather than listing the open markets here
  // means a market that closes stops accepting new shops without a code change.
  return MARKETS[raw].marketplace_status === 'active' ? raw : undefined
}
