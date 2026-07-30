/**
 * lib/market-url.ts — the ONE place that knows how a market code becomes a URL.
 *
 * Epic 07 · market-architecture-foundation, Sprint 2 (decisions D7, D7b, D8).
 *
 * ── What moved, and what deliberately did not ────────────────────────────────
 * The Mexico marketplace moved from the bare platform paths to a literal `/mx`
 * prefix. Exactly three path families moved (D7):
 *
 *     /            → /mx          (the marketplace homepage; `/` is now the
 *                                  master-brand market selector)
 *     /l, /l/<id>  → /mx/l, /mx/l/<id>
 *     /s/<slug>…   → /mx/s/<slug>…
 *
 * Everything else on the platform host stays where it is — `/g`, `/v`, `/e`,
 * `/vecindario`, `/comparador`, `/agent`, `/acerca`, `/vende/*`, `/sell`,
 * `/shop`, `/account`, `/admin`. That is a deliberate scope call in D7, not an
 * oversight: those surfaces are non-catalog, seller-side or single-market
 * editorial, and prefixing them triples the diff for no isolation gain.
 *
 * `/c/<collection>` is NOT here, and its absence is a correction to D7's scope
 * table rather than a miss. `app/(shell)/c/[collection]/page.tsx` resolves its
 * shop from the `x-miyagi-shop-slug` request header that middleware sets ONLY on
 * a subdomain/custom domain; on the platform host it self-404s by design. It is
 * a tenant-channel route, never an indexable marketplace URL, so there is
 * nothing to move and nothing to redirect. The marketplace collection path is
 * `/s/<slug>/c/<collection>`, which the `/s/` family already covers.
 *
 * ── The rule every absolute link obeys ───────────────────────────────────────
 * A marketplace URL on the PLATFORM host carries the market prefix. The same
 * logical page on a TENANT channel (subdomain, custom domain, embed) carries no
 * prefix at all and never will — a tenant is not a country marketplace. So a
 * link builder that emits an absolute URL has to know which of the two it is
 * addressing, and it learns that from the ORIGIN it was handed
 * (`marketplaceUrl`), never by sniffing ambient request state. Components that
 * emit relative links take a `marketBasePath` prop instead (D7b) — a component
 * that calls `headers()` to guess its own context is how a parallel scope list
 * drifts (`Roadmap/LEARNINGS.md`, platform-theme).
 *
 * PURE. Imports only the zero-import market registry and the pure platform-host
 * predicate. No `next/*`, no `fetch`, no env — so middleware, a Server
 * Component, a route handler and a Playwright `api` spec all share one
 * implementation, and every branch is reachable from a test with no network.
 */

import { DEFAULT_MARKET, MARKET_CODES, marketBasePath, type MarketCode } from './markets'
import { isPlatformOrigin } from './platform-host'

/**
 * The path families that carry a market prefix on the platform host.
 *
 * Written as data, and consumed by BOTH the redirect decision and the
 * strip/normalize direction below, so "which paths are market-scoped" is stated
 * once. A second hand-maintained list is the drift this epic keeps warning about.
 */
export const MARKET_PREFIXED_PATH_FAMILIES = ['/l', '/s'] as const

/** `mx` → `/mx`. Re-exported so callers need only this module. */
export { marketBasePath }

/** Every market's URL prefix, longest-first so matching is unambiguous. */
const MARKET_PREFIXES: readonly string[] = MARKET_CODES.map((code) => `/${code}`)

/**
 * Does this platform-host path belong to a family that moved under `/mx`?
 *
 * `/l` (the browse index) matches exactly; `/l/<id>` and `/s/<slug>…` match as
 * prefixes. A bare `/s` does NOT match: there is no `/s` index route and there
 * is no `/mx/s` either, so redirecting it would only trade one 404 for another.
 */
export function isMarketPrefixablePath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false
  const path = stripTrailingSlash(pathname)
  for (const family of MARKET_PREFIXED_PATH_FAMILIES) {
    if (family === '/l' && path === '/l') return true
    if (path.startsWith(`${family}/`)) return true
  }
  return false
}

/**
 * Strip ONE trailing slash, except from the root.
 *
 * Load-bearing for "one hop, no chains": Next.js normalizes `/mx/l/` to `/mx/l`
 * with its own 308, so redirecting `/l/` to `/mx/l/` would produce a two-hop
 * chain — exactly what D8 forbids. Normalizing here makes the single hop land on
 * the already-canonical form.
 */
function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

/**
 * Prefix a platform-host path with a market: `/l/x` → `/mx/l/x`, `/` → `/mx`.
 *
 * Idempotent by construction — a path that already starts with a market prefix
 * is returned untouched, so no call site can build `/mx/mx/l/x` and no redirect
 * built from this can loop.
 */
export function marketPrefixedPath(pathname: string, market: MarketCode = DEFAULT_MARKET): string {
  const base = marketBasePath(market)
  const path = stripTrailingSlash(pathname || '/')
  if (hasMarketPrefix(path)) return path
  if (path === '/') return base
  if (!isMarketPrefixablePath(path)) return path
  return `${base}${path}`
}

/** Does this path already start with any market's prefix? */
export function hasMarketPrefix(pathname: string): boolean {
  return MARKET_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * The inverse: `/mx/l/x` → `/l/x`, `/mx` → `/`.
 *
 * Every pure path predicate that existed before the cutover — "hide the tab bar
 * on a PDP", "is the seasonal theme eligible here", "which tab is active" — was
 * written against the UN-prefixed shape and is still correct about the *kind* of
 * page. Rather than teaching each of them about markets (a parallel list, again),
 * they normalize their input through this one function.
 */
export function stripMarketPrefix(pathname: string): string {
  if (!pathname) return pathname
  for (const prefix of MARKET_PREFIXES) {
    if (pathname === prefix) return '/'
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  }
  return pathname
}

/** The market a platform-host path names, or `null` when it carries no prefix. */
export function marketFromPath(pathname: string): MarketCode | null {
  if (!pathname) return null
  for (const code of MARKET_CODES) {
    const prefix = `/${code}`
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return code
  }
  return null
}

/**
 * The middleware decision (D8), as a pure function so the redirect matrix is a
 * unit test rather than a live probe.
 *
 * Returns the `/mx` target for a legacy platform-host marketplace path, or
 * `null` when the path must be left alone. `null` covers three distinct cases
 * and they are all deliberate:
 *
 *   · a path that never moved (`/vende`, `/account`, `/g/x`, `/c/x`);
 *   · a path that is ALREADY market-prefixed — so the rule cannot chain or loop
 *     against its own output;
 *   · the root `/`, which is now a real page (the market selector) and must NOT
 *     redirect: a visitor has to be able to choose, and an IP/language guess is
 *     allowed to recommend but never to redirect (Story 2.1).
 *
 * The caller is responsible for only ever asking on a PLATFORM host. A tenant
 * subdomain/custom domain returns from its own branch far earlier in
 * `middleware.ts`, which is the whole point of D8's ordering.
 */
export function platformMarketRedirectPath(
  pathname: string,
  market: MarketCode = DEFAULT_MARKET,
): string | null {
  if (!pathname || !pathname.startsWith('/')) return null
  if (hasMarketPrefix(pathname)) return null
  if (!isMarketPrefixablePath(pathname)) return null
  const target = marketPrefixedPath(pathname, market)
  return target === stripTrailingSlash(pathname) ? null : target
}

/**
 * Build an ABSOLUTE marketplace URL against a caller-supplied origin.
 *
 * The origin decides the prefix, and that is the only input consulted: a
 * platform origin gets `/mx/...`, a tenant origin (a seller's own domain or
 * subdomain) gets the un-prefixed path it has always had. An unparseable or
 * unknown origin is treated as a tenant — the fail-safe direction, because the
 * worst outcome is one extra 308 on the platform host, whereas the other
 * default would stamp `/mx` onto a merchant's own domain.
 *
 * This is the seam every emitted absolute URL goes through: checkout
 * `cancel_url`s, notification emails, Telegram/WhatsApp messages, print PDFs,
 * short-link targets, UCP/MCP payloads.
 */
export function marketplaceUrl(
  origin: string,
  pathname: string,
  market: MarketCode = DEFAULT_MARKET,
): string {
  const base = (origin ?? '').replace(/\/+$/, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (!isPlatformOrigin(base)) return `${base}${path}`
  return `${base}${marketPrefixedPath(path, market)}`
}

/** `marketplaceUrl` for a listing PDP. */
export function listingUrlFor(origin: string, listingId: string, market: MarketCode = DEFAULT_MARKET): string {
  return marketplaceUrl(origin, `/l/${listingId}`, market)
}

/** `marketplaceUrl` for a shop storefront. */
export function shopUrlFor(origin: string, slug: string, market: MarketCode = DEFAULT_MARKET): string {
  return marketplaceUrl(origin, `/s/${slug}`, market)
}
