/**
 * lib/shop-url-analyzer-fetch.ts
 *
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 3 · US-3.1) —
 * the server-side, SSRF-hardened fetch of a merchant-pasted shop URL, called
 * from POST /api/comparador/analyze. `server-only` — the pure detection/scoring
 * logic this hands its result to lives in lib/shop-url-analyzer.ts (next-free,
 * unit-spec'd directly).
 *
 * This is a FULLY OPEN target by design (any public shop URL, not an allow-
 * listed host like app/api/img/route.ts's R2/Supabase-only proxy) — same
 * untrusted-domain shape as lib/shopify-mcp-client.ts's connector, so it
 * mirrors that file's exact SSRF discipline rather than inventing a new one:
 *
 *  1. `isPublicDomainShape` (lib/ssrf-guard.ts) — friendly early-reject for a
 *     bad shape / bare IP literal / localhost, before any DNS or network call.
 *  2. `assertPublicHost` — resolves DNS and rejects if ANY resolved address is
 *     loopback/private/link-local/reserved before the real fetch goes out.
 *     CORRECTION (2026-07-18 review round — an earlier draft of this comment
 *     and the PR body overclaimed this as "closing" the DNS-rebinding gap):
 *     this SUBSTANTIALLY MITIGATES rebinding, it does not fully close it —
 *     there is an inherent TOCTOU between this resolve and the `fetch()` call
 *     a few lines later (same resolve-then-fetch pattern as the pre-existing
 *     `assertPublicHost` in lib/shopify-mcp-client.ts, and the same residual
 *     gap). Narrowed further by: https-only (TLS certificate validation
 *     against the original SNI/hostname — a rebound IP presenting the wrong
 *     cert can't silently succeed), `redirect: 'error'`, an 8s timeout, a 2 MB
 *     cap, and — specific to this analyzer — the raw fetched body is never
 *     returned to the caller (only derived counts/booleans), so even a
 *     successful rebind can't exfiltrate arbitrary bytes through this
 *     endpoint. A real fix (DNS-pin the resolved IP so the later `fetch()`
 *     can't re-resolve at all) is tracked as a follow-up, not done here — see
 *     Roadmap/00-ideas/seeds/ssrf-dns-pinning.md.
 *  3. https-only, `redirect: 'error'` (mirrors app/api/img/route.ts — a 3xx
 *     from an already-validated host could otherwise pivot the fetch to an
 *     unvalidated one; Node would silently follow up to 20 redirects without
 *     re-checking the Location host).
 *  4. A running byte-counter cap on the streamed response body (mirrors
 *     app/api/img/route.ts) — `content-length` is advisory, so this cancels
 *     the read the instant the true total crosses the cap, never buffers an
 *     unbounded body into memory first. The boundary chunk (the one that
 *     crosses the cap) is trimmed and kept, not dropped whole — otherwise a
 *     cap crossed mid-chunk would silently lose up to one chunk's worth of
 *     real HTML right at the boundary.
 *  5. Short timeout (`AbortSignal.timeout`) + content-type gate (`text/html`
 *     only) — bounds both latency and the class of response this route will
 *     ever try to parse as a storefront page.
 *
 * Every failure path returns `{ ok: false }` with an es-MX, non-technical
 * message and an HTTP status the route can pass straight through — never
 * throws, so a caller (the route) can't accidentally 500 a public, anonymous,
 * rate-limited surface. This is the "degrades gracefully to manual entry"
 * contract from sprint-3.md's acceptance criteria.
 */
import 'server-only'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isPublicDomainShape, isPrivateIpv4, isPrivateIpv6 } from './ssrf-guard'
import { buildAnalyzerResult, type ShopAnalyzerResult } from './shop-url-analyzer'

const FETCH_TIMEOUT_MS = 8_000
// A shop's homepage HTML rarely needs more than a few hundred KB to expose the
// signals this analyzer looks for (meta tags, nav, first fold of JSON-LD) —
// 2 MB bounds both the parse cost and a malicious/runaway origin's ability to
// inflate this request's memory, same reasoning as app/api/img/route.ts's
// MAX_SOURCE_BYTES.
const MAX_HTML_BYTES = 2 * 1024 * 1024

/**
 * A substantial SSRF mitigation, not a hard boundary — see file header for
 * the full residual-TOCTOU caveat and the DNS-pinning follow-up. Identical
 * contract (and identical residual gap) to `assertPublicHost` in
 * lib/shopify-mcp-client.ts (not imported from there: that file is scoped to
 * the Shopify UCP-MCP connector's own retry/pagination concerns, and
 * duplicating this ~10-line DNS wrapper here keeps this file's only coupling
 * to the migrations epic the classifiers it re-uses from lib/ssrf-guard.ts,
 * not an unrelated connector module).
 */
async function assertPublicHost(host: string): Promise<boolean> {
  try {
    const results = await dnsLookup(host, { all: true, verbatim: true })
    if (results.length === 0) return false
    return results.every((r) => (r.family === 6 ? !isPrivateIpv6(r.address) : !isPrivateIpv4(r.address)))
  } catch {
    return false
  }
}

export type AnalyzeShopUrlResult =
  | { ok: true; result: ShopAnalyzerResult }
  | { ok: false; status: number; error: string }

export async function analyzeShopUrl(rawUrl: string): Promise<AnalyzeShopUrlResult> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { ok: false, status: 422, error: 'Ingresa una URL válida (ej. https://mitienda.com).' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, status: 422, error: 'Solo podemos analizar direcciones https://.' }
  }
  if (!isPublicDomainShape(parsed.hostname)) {
    return { ok: false, status: 422, error: 'Esa dirección no parece ser una tienda pública válida.' }
  }
  if (!(await assertPublicHost(parsed.hostname))) {
    return { ok: false, status: 422, error: 'No pudimos verificar esa dirección como una tienda pública.' }
  }

  let upstream: Response
  try {
    upstream = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
      headers: { 'User-Agent': 'Miyagi-Comparador/1.0 (+https://miyagisanchez.com/comparador)' },
    })
  } catch {
    return {
      ok: false,
      status: 504,
      error: 'No pudimos abrir esa tienda a tiempo. Intenta de nuevo o llena los datos a mano abajo.',
    }
  }
  if (!upstream.ok || !upstream.body) {
    return { ok: false, status: 502, error: 'Esa tienda no respondió correctamente. Llena los datos a mano abajo.' }
  }
  const contentType = upstream.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) {
    return { ok: false, status: 415, error: 'Esa dirección no parece ser la página de una tienda.' }
  }

  const reader = upstream.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = MAX_HTML_BYTES - total
      if (value.byteLength > remaining) {
        // The boundary chunk (the one that crosses the cap): keep the part
        // that still fits instead of dropping the whole chunk — otherwise a
        // cap crossed mid-chunk silently loses up to one chunk's worth of
        // real HTML right at the boundary (codex catch, 2026-07-18 review).
        truncated = true
        if (remaining > 0) chunks.push(value.slice(0, remaining))
        total += remaining
        await reader.cancel('source too large').catch(() => {})
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } catch {
    return { ok: false, status: 502, error: 'No pudimos leer esa tienda. Llena los datos a mano abajo.' }
  }

  const html = Buffer.concat(chunks).toString('utf-8')
  if (!html.trim()) {
    return { ok: false, status: 502, error: 'Esa tienda no devolvió contenido para analizar.' }
  }

  const result = buildAnalyzerResult({ url: parsed.toString(), html, truncated })
  return { ok: true, result }
}
