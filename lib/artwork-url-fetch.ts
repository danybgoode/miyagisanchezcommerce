/**
 * lib/artwork-url-fetch.ts
 *
 * SSRF-hardened download of an MCP caller-supplied `artwork_url`
 * (POST /api/ucp/mcp's `create_checkout` configurator path —
 * app/api/ucp/mcp/route.ts's `handleCreateConfiguredCheckout`). Filed as its
 * own seed (Roadmap/00-ideas/seeds/ssrf-artwork-url-mcp.md) after
 * `ssrf-dns-pinning` Sprint 1 shipped its two call sites — this is the
 * THIRD, and unlike those two it sits behind NO auth at all (`create_checkout`
 * is in `MCP_BUYER_TOOLS`; the route applies only a 120 req/min per-IP rate
 * limit) and previously accepted `http://`, followed redirects, and only
 * checked an advisory `content-length` header before an unbounded
 * `arrayBuffer()` read — see the seed's exposure analysis.
 *
 * Mirrors `lib/shop-url-analyzer-fetch.ts`'s discipline (https-only,
 * `pinnedFetch`, `redirect: 'error'`, streamed byte cap) with two
 * differences dictated by what THIS caller does with the bytes:
 *  - No content-type gate — the downloaded bytes are validated by
 *    `ingestArtworkBytes`'s own real magic-byte sniff (lib/artwork-ingest.ts)
 *    before anything is stored, so gating on a caller-controllable header
 *    here would add nothing.
 *  - On cap overrun this REJECTS the whole download rather than trimming and
 *    keeping the boundary chunk the way the HTML analyzer does — the
 *    analyzer can usefully parse truncated HTML, but a partial image file is
 *    not a valid image; there is nothing useful to keep, and
 *    `ingestArtworkBytes` would only fail it anyway.
 *
 * Every failure — bad scheme, private/unresolvable host, a followed
 * redirect, an over-cap body, a network error — collapses to the SAME
 * `{ ok: false }` shape, with no reason attached. The caller (the route) must
 * turn that into ONE generic message: three distinguishable strings here
 * previously let an anonymous caller use this endpoint as a port-scanning
 * oracle against internal hosts (an HTTP status leaked reachability, a
 * content-length check leaked resource size, and the raw network-error
 * string distinguished refused/timeout/DNS-fail).
 *
 * Kept `server-only`-free on purpose, same reason `lib/ssrf-fetch.ts` is (see
 * that file's header): the Playwright `api` runner imports this module
 * directly to unit-test the scheme/host/cap behavior deterministically, and
 * `server-only` throws immediately when imported outside a Next build. This
 * module is only ever called from the MCP route (already a server-only
 * context) — nothing client-side imports it.
 */
import { Buffer } from 'node:buffer'
import { pinnedFetch, SsrfBlockedError, type PinnedFetchResolver } from './ssrf-fetch'

export type DownloadArtworkResult = { ok: true; bytes: Uint8Array } | { ok: false }

const ARTWORK_FETCH_TIMEOUT_MS = 15_000

/**
 * PURE stream consumer — no network, no scheme/host validation of its own.
 * Reads `body` and returns the concatenated bytes, or `null` if the TRUE
 * running total of bytes actually read (never an advertised `content-length`,
 * which is only advisory and can lie, or simply be absent on a chunked
 * response) would cross `maxBytes` — cancelling the stream the instant that
 * happens rather than buffering the over-cap chunk into memory first.
 *
 * Exported so the cap logic itself can be unit-tested directly against a
 * synthetic stream (no local server / real network needed) — see
 * e2e/artwork-url-fetch.spec.ts.
 */
export async function readCappedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        await reader.cancel('artwork exceeds byte cap').catch(() => {})
        return null
      }
      chunks.push(value)
      total += value.byteLength
    }
  } catch {
    return null
  }
  // Explicit import, not the ambient Node global: unlike
  // lib/shop-url-analyzer-fetch.ts (which relies on the implicit `Buffer`
  // global safely, because it's `server-only`), this module is deliberately
  // NOT server-only (see file header) — an exported, non-server-only lib
  // could in principle be pulled into an Edge/web-standard context where
  // `Buffer` isn't ambient, so this imports it explicitly rather than
  // relying on ambient Node typings that only hold in this repo's actual
  // (Node) runtime.
  return Buffer.concat(chunks)
}

/**
 * Downloads `rawUrl` under the full SSRF-hardened discipline described in
 * this file's header. `opts.resolve`/`opts.unsafeSkipPrivateCheckForTest`
 * are the SAME test-only seams `pinnedFetch` defines (lib/ssrf-fetch.ts) —
 * production call sites never pass them.
 */
export async function downloadArtworkBytes(
  rawUrl: string,
  maxBytes: number,
  opts?: { resolve?: PinnedFetchResolver; unsafeSkipPrivateCheckForTest?: boolean },
): Promise<DownloadArtworkResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false }
  }
  // https-only: rejecting every non-https scheme outright, before any DNS or
  // network call, is what preserves TLS certificate validation against the
  // hostname the caller actually gave us (see lib/ssrf-fetch.ts's header for
  // why that matters against a DNS-rebound target).
  if (url.protocol !== 'https:') {
    return { ok: false }
  }

  let res: Awaited<ReturnType<typeof pinnedFetch>>
  try {
    res = await pinnedFetch(
      url,
      { signal: AbortSignal.timeout(ARTWORK_FETCH_TIMEOUT_MS), redirect: 'error' },
      opts,
    )
  } catch (e) {
    // Deliberately branched, not merged into a single `catch { return { ok:
    // false } }`: this documents that SsrfBlockedError (private/reserved/
    // unresolvable host) is EXPLICITLY collapsed into the same outcome as
    // every other network failure (timeout, connection refused, a rejected
    // redirect) — a reviewer should read this as "the SSRF rejection is
    // intentionally indistinguishable from any other failure," not as an
    // accidentally-swallowed error. See file header for why that collapse
    // matters (the oracle this closes).
    if (e instanceof SsrfBlockedError) {
      return { ok: false }
    }
    return { ok: false }
  }

  if (!res.ok || !res.body) {
    // Drain/cancel now so an early return never leaves the pinned
    // per-request socket open (mirrors lib/shop-url-analyzer-fetch.ts).
    await res.body?.cancel().catch(() => {})
    return { ok: false }
  }

  // undici's Response#body is structurally a WHATWG ReadableStream<Uint8Array>
  // but ships its own (slightly narrower) type from a different lib — cast at
  // this one boundary rather than loosen readCappedBody's public signature,
  // which stays the standard DOM type so it's directly testable against a
  // synthetic `new ReadableStream(...)` in specs.
  const bytes = await readCappedBody(res.body as unknown as ReadableStream<Uint8Array>, maxBytes)
  if (bytes === null) return { ok: false }
  return { ok: true, bytes }
}
