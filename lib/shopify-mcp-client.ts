/**
 * lib/shopify-mcp-client.ts
 *
 * Thin JSON-RPC 2.0 client for a Shopify shop's UCP-conforming catalog MCP
 * (epic 03 · platform-migrations, Sprint 1 · US-1.1). Contract confirmed by a
 * LIVE probe against a real Shopify storefront (allbirds.com, 2026-07-11) —
 * not assumed from docs alone, which were ambiguous/incomplete on this exact
 * shape:
 *
 *  - Endpoint: `POST https://{shop_domain}/api/ucp/mcp` (works on both
 *    `*.myshopify.com` and any custom storefront domain — confirmed live).
 *  - EVERY call must carry `arguments.meta['ucp-agent'].profile` — a URL to a
 *    static JSON document describing the calling agent. Omitting it 400s with
 *    `invalid_profile_url`. Miyagi's own profile is a static file at
 *    `/.well-known/ucp-agent-profile.json` (public/.well-known/…), so this
 *    needs no live logic, just a reachable URL.
 *  - The actual payload is NOT `result.structuredContent` (early docs summary
 *    was wrong) — it's a JSON STRING inside `result.content[0].text`, which
 *    must be `JSON.parse`d. A second `content` entry is sometimes a plain-text
 *    notice (unrelated to the payload) and must be ignored, not parsed.
 *  - `search_catalog` pagination is a cursor (`pagination.cursor` /
 *    `pagination.has_next_page`), not offset-based.
 *  - Money is already integer MINOR units (e.g. `amount: 11000` = $110.00),
 *    no pesos-vs-cents heuristic needed — unlike lib/ml-import.ts's ML price
 *    branch.
 *  - We deliberately DID NOT build against the older, un-authenticated
 *    `/api/mcp` endpoint (which also has `search_catalog` under the name
 *    plus `search_shop_policies_and_faqs`) — every tool response on it
 *    carries a live deprecation notice: "will no longer be accessible after
 *    August 31, 2026." Building a durable connector against an endpoint with
 *    a ~7-week runway was rejected (escalated + confirmed with Daniel,
 *    2026-07-11). Policy/FAQ text (Story 1.1 acceptance) has no confirmed
 *    UCP-conforming replacement yet, so `fetchShopifyPolicies` below still
 *    calls the legacy endpoint for that ONE tool, best-effort, and must be
 *    re-verified against Shopify's docs before 2026-08-31.
 *
 * server-only. No auth needed to REACH a shop's endpoint (any public Shopify
 * storefront can be queried); the agent-profile URL is not a credential, just
 * a discovery document. Reads fail closed (empty/null) — never throws.
 *
 * SSRF hardening: `shop_domain` is untrusted, server-fetched input. A hostname-
 * shape check alone (`isPublicDomainShape`) doesn't stop a domain that RESOLVES
 * to a private/internal address (DNS rebinding). `pinnedFetch` (epic 09 ·
 * ssrf-dns-pinning, Sprint 1 — lib/ssrf-fetch.ts) closes that gap: it resolves
 * the hostname ONCE, rejects if any resolved address is loopback/private/
 * link-local/reserved, then physically dials that exact validated IP with the
 * original hostname preserved for TLS SNI/cert validation — no second,
 * independent resolve is ever possible. (An earlier version of this comment
 * described the previous resolve-then-`fetch()` pattern as closing this gap;
 * it only mitigated it — see lib/ssrf-fetch.ts's header for why, and
 * lib/shop-url-analyzer-fetch.ts's header for the same correction made there
 * 2026-07-18.) The classifiers `pinnedFetch` validates against live in
 * `lib/ssrf-guard.ts` (server-only-free, so the Playwright `api` runner can
 * unit-test them directly — importing `server-only` outside Next's build
 * throws immediately, same trap `next/cache` has per LEARNINGS).
 */
import 'server-only'
import { isPublicDomainShape } from './ssrf-guard'
import { pinnedFetch } from './ssrf-fetch'

const AGENT_PROFILE_URL =
  (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com').replace(/\/+$/, '') +
  '/.well-known/ucp-agent-profile.json'

const FETCH_TIMEOUT_MS = 10_000
const MAX_PAGES = 20 // hard cap — a runaway paginator can't hang a fetch/import request

export type ShopifyUcpMoney = { amount: number | string; currency?: string | null }

export type ShopifyUcpVariant = {
  id?: string | null
  sku?: string | null
  title?: string | null
  price?: ShopifyUcpMoney | null
  availability?: { available?: boolean | null } | null
  options?: Array<{ name?: string | null; label?: string | null }> | null
  media?: Array<{ type?: string | null; url?: string | null }> | null
}

export type ShopifyUcpProduct = {
  id?: string | null
  handle?: string | null
  title?: string | null
  description?: { html?: string | null; plain?: string | null } | string | null
  url?: string | null
  price_range?: { min?: ShopifyUcpMoney | null; max?: ShopifyUcpMoney | null } | null
  media?: Array<{ type?: string | null; url?: string | null }> | null
  variants?: ShopifyUcpVariant[] | null
}

type UcpSearchResult = {
  products?: ShopifyUcpProduct[]
  pagination?: { cursor?: string | null; has_next_page?: boolean | null }
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  return trimmed.toLowerCase()
}

async function callTool(
  domain: string,
  path: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  const host = normalizeDomain(domain)
  if (!host || !isPublicDomainShape(host)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // pinnedFetch throws SsrfBlockedError for a private/unresolvable host —
    // caught below along with every other failure mode, preserving this
    // function's fail-closed-null contract (it never throws).
    const res = await pinnedFetch(new URL(`https://${host}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as {
      result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      error?: unknown
    } | null
    if (!body || body.error || body.result?.isError) return null
    const blocks = body.result?.content ?? []
    for (const block of blocks) {
      if (block.type !== 'text' || !block.text) continue
      // The real payload parses as JSON; a plain-text deprecation/notice block does not — skip it.
      try {
        return JSON.parse(block.text) as unknown
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** One page of `search_catalog` against a shop's UCP endpoint. */
export async function searchShopifyCatalog(
  domain: string,
  opts: { query?: string; cursor?: string; limit?: number } = {},
): Promise<UcpSearchResult | null> {
  const payload = await callTool(domain, '/api/ucp/mcp', 'search_catalog', {
    meta: { 'ucp-agent': { profile: AGENT_PROFILE_URL } },
    catalog: {
      query: opts.query ?? '',
      pagination: { cursor: opts.cursor, limit: opts.limit ?? 100 },
    },
  })
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { products?: unknown; pagination?: unknown }
  return {
    products: Array.isArray(p.products) ? (p.products as ShopifyUcpProduct[]) : [],
    pagination: (p.pagination as UcpSearchResult['pagination']) ?? undefined,
  }
}

/**
 * Paginate `search_catalog` to pull (up to) a shop's full product set. A
 * broad, empty-ish query ('*') plus a high per-page limit is the closest
 * thing to "list everything" this tool exposes — there's no dedicated
 * list-all endpoint. Stops at MAX_PAGES so a shop with a very deep catalog
 * degrades to a partial (still useful) batch rather than hanging.
 */
export async function fetchAllShopifyProducts(
  domain: string,
  opts: { maxItems?: number } = {},
): Promise<{ products: ShopifyUcpProduct[]; truncated: boolean; failed: boolean }> {
  const maxItems = opts.maxItems ?? 2000
  const products: ShopifyUcpProduct[] = []
  let cursor: string | undefined
  let page = 0
  let sawAnyPage = false

  while (page < MAX_PAGES && products.length < maxItems) {
    const result = await searchShopifyCatalog(domain, { query: '*', cursor, limit: 100 })
    if (!result) return { products, truncated: false, failed: !sawAnyPage }
    sawAnyPage = true
    products.push(...result.products!)
    page++
    if (!result.pagination?.has_next_page || !result.pagination.cursor) {
      return { products: products.slice(0, maxItems), truncated: false, failed: false }
    }
    cursor = result.pagination.cursor
  }
  return { products: products.slice(0, maxItems), truncated: true, failed: false }
}

/**
 * Best-effort policy/FAQ text (Story 1.1 acceptance: "policies text attached
 * to the batch"). Calls the LEGACY `/api/mcp` endpoint — see file header:
 * no confirmed UCP-conforming replacement exists yet. A failure here is
 * NON-FATAL to the connector (the catalog pull is the hard requirement);
 * callers should treat a null return as "no policies text available."
 *
 * ⚠️ Re-verify against Shopify's docs before 2026-08-31 — this endpoint's own
 * live response carries a deprecation notice for that date.
 */
export async function fetchShopifyPolicies(domain: string): Promise<string | null> {
  const payload = await callTool(domain, '/api/mcp', 'search_shop_policies_and_faqs', {
    query: 'shipping, returns, and general store policies',
  })
  const entries = Array.isArray(payload) ? payload : []
  if (entries.length === 0) return null
  const lines = entries
    .filter((e): e is { question?: string; answer?: string } => typeof e === 'object' && e !== null)
    .map((e) => `${e.question ?? ''}\n${e.answer ?? ''}`.trim())
    .filter(Boolean)
  return lines.length > 0 ? lines.join('\n\n') : null
}
