/**
 * market-medusa.ts — the ONE place a market code becomes a Medusa identifier.
 *
 * `lib/markets.ts` (the registry) deliberately holds NO Medusa Region or Sales
 * Channel id: those differ between local, preview and production, so an id in the
 * registry would be a lie in every environment but one (epic decision D2). This
 * module is the environment-resolved half of that split, and it is mirrored — same
 * function names, same contract — by `apps/backend/src/lib/market-medusa.ts`.
 *
 * PURE OVER AN INJECTED ENV OBJECT. Nothing here reads `process.env` on its own,
 * which is what lets a Playwright `api` spec drive every branch with a plain object
 * and no `process.env` mutation. The one place we DO read the real environment is
 * `PROCESS_MARKET_ENV` below, and it reads each variable by literal member access
 * for a reason that has caused a production outage here before — see its comment.
 *
 * Fail-closed contract:
 *   · unknown market            ⇒ THROWS `UnknownMarketError` (from the registry).
 *   · configured market        ⇒ only that market's Region, Sales Channel, and
 *                                 publishable key. Cross-market fallback is forbidden.
 *   · unconfigured market      ⇒ the resolver's named empty/unconfigured result;
 *                                 callers must surface unavailability, never retry MX.
 *   · `mx`                      ⇒ its legacy env ordering and empty-string Region
 *                                 behavior remain byte-compatible.
 */

import { requireMarket, type MarketCode } from './markets'

/** The shape this module accepts instead of touching `process.env` itself. */
export interface MarketMedusaEnv {
  readonly [key: string]: string | undefined
}

/**
 * Region env vars per market, in resolution order (first DEFINED wins — including
 * an explicitly empty string, which is what `??` does and what `lib/cart.ts` did
 * before this seam existed).
 *
 * Written as a total table over `MarketCode` on purpose — adding a market makes
 * this object fail to type-check until someone decides what its Region is, instead
 * of silently inheriting Mexico's.
 */
const REGION_ENV_VARS: Readonly<Record<MarketCode, readonly string[]>> = Object.freeze({
  // NEXT_PUBLIC_ first: `lib/cart.ts` runs in the browser for BuyButton /
  // MercadoPagoButton, where only the NEXT_PUBLIC_ copy is inlined. The bare
  // server var is the fallback for server-side callers. This order is the one
  // that shipped; changing it would change MX cart behaviour.
  mx: Object.freeze(['NEXT_PUBLIC_MEDUSA_MXN_REGION_ID', 'MEDUSA_MXN_REGION_ID']),
  us: Object.freeze(['MEDUSA_US_REGION_ID']),
})

/**
 * Marketplace Sales Channel env vars per market — the channel whose membership IS
 * marketplace-publication truth. Same total-table reasoning as `REGION_ENV_VARS`.
 */
const CHANNEL_ENV_VARS: Readonly<Record<MarketCode, readonly string[]>> = Object.freeze({
  mx: Object.freeze(['MEDUSA_SALES_CHANNEL_ID']),
  us: Object.freeze(['MEDUSA_US_MARKETPLACE_CHANNEL_ID']),
})

const PUBLISHABLE_KEY_ENV_VARS: Readonly<Record<MarketCode, readonly string[]>> = Object.freeze({
  // Preserve the browser-visible legacy name first. Server deployments may also
  // carry the backend spelling, and `??` semantics below keep an explicitly empty
  // browser value visible instead of silently selecting a different market key.
  mx: Object.freeze(['NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY', 'MEDUSA_PUBLISHABLE_KEY']),
  us: Object.freeze(['MEDUSA_US_PUBLISHABLE_KEY']),
})

export type PublishableKeyResolution =
  | { readonly status: 'resolved'; readonly market: MarketCode; readonly kind: 'publishable_key_token'; readonly token: string }
  | { readonly status: 'unconfigured'; readonly market: MarketCode; readonly kind: 'publishable_key_token'; readonly env_var: string; readonly reason: string }

/**
 * Resolve the Store API token selected by authoritative market context. This is
 * deliberately a named result: "US has no key configured" is an outage, not an
 * empty catalog and never permission to retry with Mexico's key.
 */
export function resolvePublishableKeyForMarket(
  market: unknown,
  env: MarketMedusaEnv,
): PublishableKeyResolution {
  const record = requireMarket(market)
  const names = PUBLISHABLE_KEY_ENV_VARS[record.code]
  const token = firstDefined(env, names)?.trim() ?? ''
  if (token) return { status: 'resolved', market: record.code, kind: 'publishable_key_token', token }
  return {
    status: 'unconfigured',
    market: record.code,
    kind: 'publishable_key_token',
    env_var: names[0],
    reason: `Market "${record.code}" expects a publishable key token but ${names[0]} is unset.`,
  }
}

export function resolvePublishableKey(market: unknown, env: MarketMedusaEnv): string | null {
  const resolution = resolvePublishableKeyForMarket(market, env)
  return resolution.status === 'resolved' ? resolution.token : null
}

/** First defined value across `names`, or `undefined` when none is set. */
function firstDefined(env: MarketMedusaEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * The Medusa Region id a market's carts and prices belong to.
 *
 * `null` means "this market has no Region mapping"; an expected mapping whose env
 * value is unset keeps the legacy empty-string wire value. Neither case permits
 * fallback to another market's Region.
 *
 * The `?? ''` for a configured-but-unset `mx` is NOT laziness: `lib/cart.ts` sent
 * `region_id: ''` in exactly that case before this seam existed, and the backend
 * answers it with its own error. This PR promises MX cart behaviour is unchanged,
 * so the empty string is preserved deliberately rather than "improved" into a throw
 * that would newly break a misconfigured environment at a different layer.
 */
export function resolveRegionIdForMarket(market: unknown, env: MarketMedusaEnv): string | null {
  const record = requireMarket(market)
  const names = REGION_ENV_VARS[record.code]
  if (names.length === 0) return null
  return firstDefined(env, names) ?? ''
}

/**
 * The Medusa Sales Channel id that represents a market's marketplace.
 *
 * `null` means "this market has no resolvable marketplace channel". Unlike the
 * Region there is no legacy empty-string caller to preserve here (the old
 * `DEFAULT_SALES_CHANNEL_ID` export had no consumer at all), so an unresolvable
 * channel answers `null` rather than a string that would silently match nothing.
 */
export function resolveMarketplaceChannelId(market: unknown, env: MarketMedusaEnv): string | null {
  const record = requireMarket(market)
  const names = CHANNEL_ENV_VARS[record.code]
  if (names.length === 0) return null
  return firstDefined(env, names) ?? null
}

/**
 * The real environment, snapshotted by LITERAL member access.
 *
 * Do NOT replace this with `process.env` passed straight into the resolvers. Next
 * inlines a NEXT_PUBLIC_ variable into the client bundle only where it sees the
 * literal member-access text in the source; handing the whole object to a function
 * defeats that and the value bakes in as `undefined` forever. That exact mistake
 * caused a live checkout outage here (see `nextpublic-docker-buildargs-hardening`
 * and the build-arg spec that guards it), which is why this constant exists and
 * why a spec asserts no caller passes bare `process.env` to the resolvers.
 */
export const PROCESS_MARKET_ENV: MarketMedusaEnv = {
  NEXT_PUBLIC_MEDUSA_MXN_REGION_ID: process.env.NEXT_PUBLIC_MEDUSA_MXN_REGION_ID,
  MEDUSA_MXN_REGION_ID: process.env.MEDUSA_MXN_REGION_ID,
  MEDUSA_SALES_CHANNEL_ID: process.env.MEDUSA_SALES_CHANNEL_ID,
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
  MEDUSA_PUBLISHABLE_KEY: process.env.MEDUSA_PUBLISHABLE_KEY,
  MEDUSA_US_REGION_ID: process.env.MEDUSA_US_REGION_ID,
  MEDUSA_US_MARKETPLACE_CHANNEL_ID: process.env.MEDUSA_US_MARKETPLACE_CHANNEL_ID,
  MEDUSA_US_PUBLISHABLE_KEY: process.env.MEDUSA_US_PUBLISHABLE_KEY,
}
