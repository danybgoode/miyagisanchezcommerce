/**
 * lib/ssrf-fetch.ts
 *
 * SSRF DNS-pinning (epic 09 · ssrf-dns-pinning, Sprint 1). A sibling of
 * `lib/ssrf-guard.ts` — imports its `isPrivateIpv4`/`isPrivateIpv6`
 * classifiers rather than redefining them (that file stays the one place
 * those predicates live; this is NOT a third guard module).
 *
 * The problem this closes: both existing untrusted-domain callers
 * (`lib/shop-url-analyzer-fetch.ts`, `lib/shopify-mcp-client.ts`) resolve a
 * hostname, validate every returned address, then call `fetch()` — which
 * resolves the SAME hostname again, independently. Between those two
 * resolves there is a TOCTOU window: an attacker controlling DNS for the
 * target domain can flip the record between them (DNS rebinding) so the
 * address that got validated is not the address that gets dialed.
 *
 * `pinnedFetch` closes that window structurally: resolve ONCE, validate
 * every returned address, then physically dial the exact validated IP via a
 * per-request undici `Agent` whose `connect.lookup` is stubbed to always
 * return that one pinned address — no second, independent resolve is ever
 * possible. The original hostname is passed to `fetch()` unchanged (only the
 * dial target is pinned), so undici derives TLS SNI/`servername` from it as
 * usual — that is what preserves certificate validation against the
 * hostname the caller actually asked for, not the IP we dialed.
 *
 * Why `undici` is imported directly (both `fetch` AND `Agent`), not Node's
 * global `fetch` with a duck-typed dispatcher: `undici` was, until this
 * epic, only a TRANSITIVE dependency of this package — hoisted from the
 * workspace root's node_modules (currently resolving to whatever version a
 * sibling package happens to need). Node 22 (the deployed Cloud Run image's
 * runtime, apps/miyagisanchez PR #289) has its OWN bundled `undici` backing
 * the global `fetch`, which is a different major than the hoisted one — so a
 * dispatcher built from a directly-imported `Agent` could silently mismatch
 * the dispatcher type the global `fetch` expects. Adding `undici` as a
 * DIRECT dependency here and importing `fetch`/`Agent` from it together
 * means both always come from the exact same package instance, in dev AND
 * in the `npm ci`-from-this-package's-own-lockfile Cloud Run build — the
 * deployed runtime's own bundled undici version becomes irrelevant, because
 * we never touch it.
 *
 * This deliberately BYPASSES Next.js's patched global `fetch` (and therefore
 * its Data Cache) — correct for both call sites here, which fetch an
 * arbitrary caller-supplied third-party origin on every call and must never
 * be cached.
 *
 * Kept `server-only`-free on purpose, same reason `lib/ssrf-guard.ts` is
 * (see that file's header): the Playwright `api` runner imports this module
 * directly to unit-test it, and `server-only` throws immediately when
 * imported outside a Next build — it would break the very test run meant to
 * cover this file. This was an open question in sprint-1.md ("`server-only`
 * enforcement on the new helper — raise it as a question in plan mode,
 * decide, move on"); the decision is: no, for the reason above.
 */
import {
  fetch as undiciFetch,
  Agent,
  type RequestInit as UndiciRequestInit,
  type Response as UndiciResponse,
} from 'undici'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isPrivateIpv4, isPrivateIpv6 } from './ssrf-guard'

/** Thrown when a host resolves to a private/reserved address, or DNS resolution fails. */
export class SsrfBlockedError extends Error {}

export type ResolvedAddress = { address: string; family: number }

/**
 * A resolver seam — swap in a stub in tests to drive `pinnedFetch` through a
 * deterministic sequence of DNS answers (e.g. the TOCTOU-closure proof: a
 * `lookup` that returns a public address first and a private one on a
 * second call). TEST-ONLY override; production callers never pass this.
 */
export type PinnedFetchResolver = (hostname: string) => Promise<ResolvedAddress[]>

const defaultResolve: PinnedFetchResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results
}

/**
 * PURE — no network. Given `node:dns` lookup results, return the address to
 * pin (always the FIRST resolved address — this is what makes the
 * TOCTOU-closure guarantee meaningful: a later, independent resolve
 * returning something else can no longer substitute a different address),
 * or `null` if ANY resolved address is private/reserved. Fails closed on an
 * empty result set.
 */
export function selectPinnedAddress(
  results: ResolvedAddress[],
): { address: string; family: 4 | 6 } | null {
  if (results.length === 0) return null
  for (const r of results) {
    const isPrivate = r.family === 6 ? isPrivateIpv6(r.address) : isPrivateIpv4(r.address)
    if (isPrivate) return null
  }
  const [first] = results
  return { address: first.address, family: first.family === 6 ? 6 : 4 }
}

/**
 * Resolves `url.hostname` ONCE, validates every returned address with the
 * shared `lib/ssrf-guard.ts` classifiers, then dials that exact pinned IP —
 * via a per-request undici `Agent` whose `connect.lookup` always answers
 * with the one validated address — while leaving `url.hostname` itself
 * untouched, so TLS SNI/cert validation still runs against the original
 * hostname. Throws `SsrfBlockedError` if the host is not public (including
 * on DNS failure — fails closed).
 *
 * Provides pinned DISPATCH only, not policy: callers keep their own
 * timeout/redirect/byte-cap/content-type rules layered on top.
 */
export async function pinnedFetch(
  url: URL,
  init?: UndiciRequestInit,
  opts?: {
    resolve?: PinnedFetchResolver
    /**
     * TEST-ONLY escape hatch. When `true`, skip `selectPinnedAddress`'s
     * private/reserved-address rejection (still fails closed on an empty
     * result set, still pins the first resolved address). Production call
     * sites never pass this — its default (`selectPinnedAddress`'s real,
     * unmodified rejection) is exactly current production behaviour.
     *
     * Why it exists: every address a sandboxed dev/CI machine can dial to
     * itself (loopback, its own LAN/CGNAT address) is, correctly,
     * `isPrivateIpv4`/`isPrivateIpv6`-private — that's the whole point of
     * the guard. That makes it impossible to drive `pinnedFetch` through a
     * real, successful connection to a local `http.createServer()` (the
     * TOCTOU-closure + hostname-preservation specs) without either
     * re-implementing the pin/dial mechanism a second time just for tests,
     * or a narrow, explicit bypass of only the rejection step here. The
     * rejection itself is separately verified with ZERO bypass, against the
     * real, unmodified classifiers, in the "rejection still works" specs.
     */
    unsafeSkipPrivateCheckForTest?: boolean
  },
): Promise<UndiciResponse> {
  const resolve = opts?.resolve ?? defaultResolve

  let results: ResolvedAddress[]
  try {
    results = await resolve(url.hostname)
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for host: ${url.hostname}`)
  }

  const pinned = opts?.unsafeSkipPrivateCheckForTest
    ? (results[0] ? { address: results[0].address, family: (results[0].family === 6 ? 6 : 4) as 4 | 6 } : null)
    : selectPinnedAddress(results)
  if (!pinned) {
    throw new SsrfBlockedError(`Host does not resolve to a public address: ${url.hostname}`)
  }

  // A fresh Agent per request (not a shared/global one) so the pinned
  // address can never leak into a connection reused for a different host —
  // destroyed in `finally` below so its socket(s) never leak.
  const agent = new Agent({
    connect: {
      lookup: (_lookupHostname, _lookupOptions, callback) => {
        callback(null, [{ address: pinned.address, family: pinned.family }])
      },
    },
  })
  try {
    return await undiciFetch(url, { ...init, dispatcher: agent })
  } finally {
    await agent.destroy()
  }
}
