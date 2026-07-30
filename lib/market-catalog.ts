/**
 * market-catalog.ts — the fail-closed decision seam for every PUBLIC MARKETPLACE
 * catalog read.
 *
 * This is the most important module in the frontend half of the market
 * architecture epic. Its entire job is to make one outcome impossible: a read
 * scoped to a market that is not open returning ANOTHER market's rows. `/us` must
 * never serve the Mexico catalog — not while the backend filter is still
 * deploying, not on an unknown market code, not on a malformed response.
 *
 * PURE. No `next/*`, no `fetch`, no env. `lib/listings.ts` is the thin I/O shell
 * that calls these functions; the Playwright `api` project drives every branch here
 * directly with plain objects.
 *
 * WHAT THIS MODULE DOES *NOT* GUARD, on purpose: owned-shop reads. A shop's own
 * storefront (`/store/sellers/:slug/products`, subdomain, custom domain, embed)
 * resolves by seller ownership plus product publish state and must keep working
 * without any marketplace channel membership at all (epic decision D4). Adding the
 * market filter there is the exact failure this epic exists to prevent.
 *
 * ── The three-state read, and why the gate is structural ────────────────────────
 * The backend deploys before this code does, so there is a window in which the
 * server-side market filter does not exist yet. A gate that depended on the server
 * confirming the filter would be fail-OPEN during precisely that window. So the
 * gate is structural instead:
 *
 *   · a market that is unknown, or whose marketplace is not open, NEVER ISSUES THE
 *     REQUEST AT ALL — `planMarketCatalogRead` refuses before any I/O. No response,
 *     no rows, nothing to leak. This holds against any backend, including none.
 *   · a market that IS open still checks the response echo, and gets three answers,
 *     never two: `confirmed` (the server named the market back), `absent` (no echo
 *     — an older backend) and `mismatch` (it named a DIFFERENT market).
 *
 * `absent` is tolerated for `DEFAULT_MARKET` only, and that tolerance is a
 * statement about the live population rather than a shrug: production has exactly
 * one Medusa Region and one marketplace Sales Channel, both Mexico's, and every
 * published product predates the registry (epic decision D0). An un-filtered
 * Mexico response and a filtered one are the same rows. For any other market
 * `absent` is unavailable — so the first non-Mexico market to go `active` cannot
 * ship ahead of its backend filter.
 */

import {
  DEFAULT_MARKET,
  getMarket,
  normalizeMarketCode,
  type MarketCode,
  type MarketRecord,
  type MarketplaceStatus,
} from './markets'

/**
 * The query parameter carrying the market to the Medusa store routes, and the
 * field the response echoes it back in. Named here once, exported, and asserted by
 * spec — a paraphrased contract drifts permissive (`LEARNINGS.md`), and this pair
 * is the wire contract with `apps/backend`.
 */
export const MARKET_QUERY_PARAM = 'market'
export const MARKET_ECHO_FIELD = 'market_code'

export type MarketUnavailableReason =
  /** The caller supplied something that is not a supported market code. */
  | 'unknown_market'
  /** A real market whose `marketplace_status` is not `active` (today: `us`). */
  | 'marketplace_not_open'
  /** Open market, but the backend did not confirm it applied the market filter. */
  | 'market_filter_unavailable'
  /** The backend answered for a DIFFERENT market than the one requested. */
  | 'market_mismatch'

/**
 * The structured "no catalog here" answer. Deliberately NOT an empty success:
 * an empty list says "this market has nothing", which is a different and much more
 * damaging claim than "this market is not open" (`LEARNINGS.md`: unknown and none
 * are different facts). Shape matches the MCP/UCP contract in epic decision D10 so
 * Sprint 2 can return it verbatim.
 */
export interface MarketUnavailable {
  readonly unavailable: true
  /** The resolved market code, or `null` when the input was not a market at all. */
  readonly market_code: MarketCode | null
  readonly marketplace_status: MarketplaceStatus | null
  readonly reason: MarketUnavailableReason
}

/** An approved read: which market, and the query fragment that scopes it. */
export interface MarketCatalogPlan {
  readonly unavailable: false
  readonly market: MarketRecord
  /** `market=mx` — appended by the I/O shell, never built by hand at a call site. */
  readonly query: string
}

export type MarketCatalogDecision = MarketCatalogPlan | MarketUnavailable

function unavailable(
  market_code: MarketCode | null,
  marketplace_status: MarketplaceStatus | null,
  reason: MarketUnavailableReason,
): MarketUnavailable {
  return Object.freeze({ unavailable: true, market_code, marketplace_status, reason })
}

/**
 * Decide whether a public marketplace catalog read may proceed, BEFORE any I/O.
 *
 * `undefined`/`null` means "an un-annotated legacy caller" and resolves to
 * `DEFAULT_MARKET` (epic decision D5) — that is the pre-launch backward-compatible
 * default described in the registry, and it is why this PR changes no MX behaviour.
 * Anything else that is not a supported code is a MISTAKE and fails closed; it is
 * never coerced to Mexico.
 */
export function planMarketCatalogRead(market?: unknown): MarketCatalogDecision {
  const requested = market === undefined || market === null ? DEFAULT_MARKET : market
  const record = getMarket(requested)
  if (!record) return unavailable(null, null, 'unknown_market')
  if (record.marketplace_status !== 'active') {
    return unavailable(record.code, record.marketplace_status, 'marketplace_not_open')
  }
  return Object.freeze({
    unavailable: false,
    market: record,
    query: `${MARKET_QUERY_PARAM}=${record.code}`,
  })
}

/** Narrowing helper so call sites read as prose rather than as a boolean field. */
export function isMarketUnavailable(decision: MarketCatalogDecision): decision is MarketUnavailable {
  return decision.unavailable
}

/**
 * Three states, never two: did the backend confirm it scoped this response to the
 * market we asked for?
 *
 *   confirmed — it echoed our market back.
 *   mismatch  — it echoed a different one. Always fatal; a Mexico payload rendered
 *               under another market is the exact defect being prevented.
 *   absent    — no echo field. "I could not check", NOT "there is no filter" and
 *               NOT "the filter ran". The caller decides (`verifyMarketFilter`).
 */
export type MarketFilterState = 'confirmed' | 'absent' | 'mismatch'

export function readMarketFilterState(payload: unknown, market: MarketCode): MarketFilterState {
  if (payload === null || typeof payload !== 'object') return 'absent'
  const raw = (payload as Record<string, unknown>)[MARKET_ECHO_FIELD]
  if (raw === undefined || raw === null || raw === '') return 'absent'
  const echoed = normalizeMarketCode(raw)
  // An echo we cannot even parse as a market code is not our market. Treat it as a
  // mismatch rather than as absent: the field IS there, so this backend does speak
  // the contract and is telling us something we do not understand.
  return echoed === market ? 'confirmed' : 'mismatch'
}

/**
 * Post-response half of the gate. Returns `null` when the payload may be served,
 * or the structured unavailable state when it may not.
 *
 * See the module header for why `absent` is survivable for `DEFAULT_MARKET` and
 * fatal for every other market.
 */
export function verifyMarketFilter(market: MarketRecord, payload: unknown): MarketUnavailable | null {
  const state = readMarketFilterState(payload, market.code)
  if (state === 'confirmed') return null
  if (state === 'mismatch') {
    return unavailable(market.code, market.marketplace_status, 'market_mismatch')
  }
  if (market.code === DEFAULT_MARKET) return null
  return unavailable(market.code, market.marketplace_status, 'market_filter_unavailable')
}

/**
 * Verify a catalog response AND extract the field the caller wants, in ONE call.
 *
 * This exists because the two-step version — `verifyMarketFilter(...)` on one line,
 * `data.listings ?? []` on another — is a pairing a reader has to remember, and one
 * read path in the first PR did not: the curated homepage pool fetched through the
 * market seam and then returned `data.listings` without ever checking the echo. A
 * cross-family review caught it. The lesson is not "look harder next time"; it is
 * that a contract enforced by convention will eventually be broken by someone
 * following a nearby example.
 *
 * So the rows and the verdict come out of the same call, and the rows are `fallback`
 * whenever the verdict is unavailable. There is no argument order that yields the
 * payload's contents without the check having run.
 */
export interface MarketScopedField<T> {
  /** The extracted value, or `fallback` when the read was refused. */
  readonly value: T
  /** Non-null exactly when the read was refused. */
  readonly unavailable: MarketUnavailable | null
}

export function takeMarketScopedField<T>(
  market: MarketRecord,
  payload: unknown,
  field: string,
  fallback: T,
): MarketScopedField<T> {
  const unavailable = verifyMarketFilter(market, payload)
  if (unavailable) return { value: fallback, unavailable }
  if (payload === null || typeof payload !== 'object') return { value: fallback, unavailable: null }
  const raw = (payload as Record<string, unknown>)[field]
  return { value: (raw ?? fallback) as T, unavailable: null }
}

/**
 * What a market-scoped list read carries in addition to its rows, so a caller (and
 * Sprint 2's `/us` surface, and the MCP tools) can tell the three cases apart
 * without re-deriving them.
 */
export interface MarketScopedMeta {
  /** The market actually read, or `null` when nothing was read. */
  readonly market_code: MarketCode | null
  /** Non-null exactly when the read was refused. */
  readonly market_unavailable: MarketUnavailable | null
}

export function marketMetaFor(market: MarketRecord): MarketScopedMeta {
  return { market_code: market.code, market_unavailable: null }
}

export function marketMetaUnavailable(state: MarketUnavailable): MarketScopedMeta {
  return { market_code: state.market_code, market_unavailable: state }
}
