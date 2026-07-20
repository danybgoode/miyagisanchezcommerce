import { test, expect } from '@playwright/test'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  shopifyProductToIncomingSupplyItem,
  shopifyCategoryToMiyagi,
  shopifyConditionToMiyagi,
  type ShopifyUcpProduct,
} from '../lib/shopify-import'
import { isPublicDomainShape, isPrivateIpv4, isPrivateIpv6 } from '../lib/ssrf-guard'
import { pinnedFetch, selectPinnedAddresses, SsrfBlockedError, type ResolvedAddress } from '../lib/ssrf-fetch'

/**
 * Shopify connector · Sprint 1 (epic 03 · platform-migrations).
 *
 * Fixtures mirror the REAL response shape confirmed by a live probe against
 * allbirds.com's `/api/ucp/mcp` `search_catalog` on 2026-07-11 (see
 * lib/shopify-mcp-client.ts header) — not a guessed/doc-summary shape.
 * The actual fetch/stage/import live in the Next.js route + Medusa internal
 * route (writes, unreachable from the `api` runner), so this gate covers what
 * the frontend owns deterministically: the pure Shopify→supply mapping incl.
 * graceful degradation, and the connector routes' flag/auth gating. The real
 * live-Shopify-domain pull + parity-report eyeball is owed to Daniel. See
 * sprint-1.md.
 */

function makeProduct(overrides: Partial<ShopifyUcpProduct> = {}): ShopifyUcpProduct {
  return {
    id: 'gid://shopify/Product/4826199687248',
    handle: 'womens-wool-runners-true-black',
    title: "Women's Wool Runner - True Black",
    description: { html: '<p>The original wool sneaker. <strong>Breathable</strong> and machine washable.</p>' },
    url: 'https://www.allbirds.com/products/womens-wool-runners-true-black',
    price_range: { min: { amount: 11000, currency: 'USD' }, max: { amount: 11000, currency: 'USD' } },
    media: [{ type: 'image', url: 'https://cdn.shopify.com/a.png' }],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/32956152938576',
        sku: 'WR3WTBK050',
        title: '5',
        price: { amount: 11000, currency: 'USD' },
        availability: { available: true },
        options: [{ name: 'Size', label: '5' }],
        media: [{ type: 'image', url: 'https://cdn.shopify.com/b.png' }],
      },
      {
        id: 'gid://shopify/ProductVariant/32956152971344',
        sku: 'WR3WTBK060',
        title: '6',
        price: { amount: 11000, currency: 'USD' },
        availability: { available: false },
        options: [{ name: 'Size', label: '6' }],
        media: [{ type: 'image', url: 'https://cdn.shopify.com/a.png' }], // dup of product-level image
      },
    ],
    ...overrides,
  }
}

test.describe('shopify-import · shopifyProductToIncomingSupplyItem', () => {
  test('maps a full product into the supply shape', () => {
    const out = shopifyProductToIncomingSupplyItem(makeProduct())
    expect(out.source_id).toBe('gid://shopify/Product/4826199687248')
    expect(out.source_url).toBe('https://www.allbirds.com/products/womens-wool-runners-true-black')
    expect(out.listing_title).toBe("Women's Wool Runner - True Black")
    expect(out.listing_description).toBe('The original wool sneaker. Breathable and machine washable.')
    expect(out.currency).toBe('USD')
    expect(out.listing_type).toBe('product')
    expect(out.category).toBe('otros')
    expect(out.condition).toBe('new')
    expect(out.price_cents).toBe(11000) // already minor units — no pesos/cents heuristic
    // Images are deduped across product + variant media pools.
    expect(out.images).toEqual([
      { url: 'https://cdn.shopify.com/a.png' },
      { url: 'https://cdn.shopify.com/b.png' },
    ])
    expect(out.metadata).toMatchObject({
      shopify_product_id: 'gid://shopify/Product/4826199687248',
      shopify_handle: 'womens-wool-runners-true-black',
      shopify_variant_count: 2,
      shopify_available: true, // at least one variant available
    })
  })

  test('falls back to variant price when price_range is absent', () => {
    const out = shopifyProductToIncomingSupplyItem(makeProduct({ price_range: null }))
    expect(out.price_cents).toBe(11000)
    expect(out.currency).toBe('USD')
  })

  test('marks unavailable when every variant is unavailable', () => {
    const product = makeProduct({
      variants: [
        { id: 'v1', price: { amount: 100, currency: 'USD' }, availability: { available: false } },
      ],
    })
    const out = shopifyProductToIncomingSupplyItem(product)
    expect(out.metadata).toMatchObject({ shopify_available: false })
  })

  test('degrades missing/odd fields gracefully (no throw, no broken product)', () => {
    const out = shopifyProductToIncomingSupplyItem({
      id: null,
      handle: 'no-title',
      title: '',
      description: null,
      url: null,
      price_range: null,
      media: null,
      variants: [],
    })
    expect(out.source_id).toBe('no-title') // falls back to handle
    expect(out.listing_title).toBeUndefined()
    expect(out.listing_description).toBeUndefined()
    expect(out.price_cents).toBeUndefined()
    expect(out.images).toEqual([])
    expect(out.category).toBe('otros')
    expect(out.condition).toBe('new')
    expect(out.currency).toBe('MXN') // default when no money anywhere
  })

  test('extracts plain text from an HTML description, and prefers `plain` when present', () => {
    const htmlOnly = shopifyProductToIncomingSupplyItem(
      makeProduct({ description: { html: '<p>Line one.</p><p>Line two.</p>' } }),
    )
    expect(htmlOnly.listing_description).toBe('Line one. Line two.')

    const withPlain = shopifyProductToIncomingSupplyItem(
      makeProduct({ description: { html: '<p>ignored</p>', plain: 'Plain wins.' } }),
    )
    expect(withPlain.listing_description).toBe('Plain wins.')
  })
})

test.describe('shopify-import · category/condition fallbacks', () => {
  test('every product maps to otros/new (no Miyagi-shaped taxonomy in Shopify UCP catalog)', () => {
    expect(shopifyCategoryToMiyagi()).toBe('otros')
    expect(shopifyConditionToMiyagi()).toBe('new')
  })
})

// ── Connector routes are flag-gated + auth-gated ───────────────────────────
test.describe('shopify import routes · gating', () => {
  test('POST /api/sell/shopify/import/fetch → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/shopify/import/fetch', { data: { shop_domain: 'example.com' } })
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/shopify/import → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/shopify/import', { data: { batchId: 'x', itemIds: ['a'] } })
    expect(res.status()).toBe(401)
  })
})

// ── SSRF hardening (cross-review finding, 2026-07-11) ───────────────────────
// `shop_domain` is untrusted, server-fetched input. `isPublicDomainShape` is
// only the friendly early-reject; the real boundary is the DNS-resolve +
// private-range check in `assertPublicHost` (not unit-testable without
// network) — these specs cover the pure pieces: domain shape, and the
// IPv4/IPv6 private/reserved-range classifiers that boundary relies on.
test.describe('shopify-mcp-client · isPublicDomainShape', () => {
  test('accepts ordinary public-looking domains', () => {
    expect(isPublicDomainShape('mitienda.com')).toBe(true)
    expect(isPublicDomainShape('mitienda.myshopify.com')).toBe(true)
    expect(isPublicDomainShape('https://mitienda.com/')).toBe(true) // protocol/path stripped
  })
  test('rejects empty, localhost, bare IPs, and IPv6/port literals', () => {
    expect(isPublicDomainShape('')).toBe(false)
    expect(isPublicDomainShape('localhost')).toBe(false)
    expect(isPublicDomainShape('printer.local')).toBe(false)
    expect(isPublicDomainShape('127.0.0.1')).toBe(false)
    expect(isPublicDomainShape('10.0.0.5')).toBe(false)
    expect(isPublicDomainShape('mitienda.com:8080')).toBe(false)
    expect(isPublicDomainShape('::1')).toBe(false)
  })
})

test.describe('shopify-mcp-client · isPrivateIpv4 (the DNS-rebinding guard)', () => {
  test('flags every private/reserved/loopback range', () => {
    expect(isPrivateIpv4('10.1.2.3')).toBe(true)
    expect(isPrivateIpv4('172.16.0.1')).toBe(true)
    expect(isPrivateIpv4('172.31.255.255')).toBe(true)
    expect(isPrivateIpv4('192.168.1.1')).toBe(true)
    expect(isPrivateIpv4('127.0.0.1')).toBe(true)
    expect(isPrivateIpv4('169.254.1.1')).toBe(true) // link-local (cloud metadata endpoints live here)
    expect(isPrivateIpv4('100.64.0.1')).toBe(true) // CGNAT
    expect(isPrivateIpv4('0.0.0.0')).toBe(true)
    expect(isPrivateIpv4('224.0.0.1')).toBe(true) // multicast+
  })
  test('a genuinely public address is not flagged', () => {
    expect(isPrivateIpv4('93.184.216.34')).toBe(false) // example.com's real IP
    expect(isPrivateIpv4('172.15.255.255')).toBe(false) // just outside 172.16/12
    expect(isPrivateIpv4('172.32.0.0')).toBe(false) // just outside 172.16/12
  })
  test('malformed input fails closed (treated as private)', () => {
    expect(isPrivateIpv4('not-an-ip')).toBe(true)
    expect(isPrivateIpv4('999.999.999.999')).toBe(true)
  })
})

test.describe('shopify-mcp-client · isPrivateIpv6', () => {
  test('flags loopback, unique-local, and link-local', () => {
    expect(isPrivateIpv6('::1')).toBe(true)
    expect(isPrivateIpv6('::')).toBe(true)
    expect(isPrivateIpv6('fd00::1')).toBe(true) // unique local (fc00::/7)
    expect(isPrivateIpv6('fe80::1')).toBe(true) // link-local
  })
  test('unwraps an IPv4-mapped address and checks the IPv4 rules', () => {
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIpv6('::ffff:93.184.216.34')).toBe(false)
  })
  test('a genuinely public IPv6 address is not flagged', () => {
    expect(isPrivateIpv6('2606:2800:220:1:248:1893:25c8:1946')).toBe(false) // example.com
  })
})

// ── SSRF DNS-pinning (epic 09 · ssrf-dns-pinning, Sprint 1) ─────────────────
// `lib/ssrf-fetch.ts` closes the TOCTOU window `assertPublicHost` alone
// leaves open: resolve ONCE, validate every returned address, then dial one
// of the exact validated IPs (never a second, independent resolve). See that
// file's header for the full rationale, including why `pinnedFetch` accepts
// an `unsafeSkipPrivateCheckForTest` escape hatch used ONLY in the
// local-server specs below (never by production call sites, and structurally
// refused outside test — `pinnedFetch` throws if it's passed with
// `NODE_ENV === 'production'`) — every address a sandboxed dev/CI machine can
// dial to itself is, correctly, private/reserved, so a real successful
// connection to a local `http.createServer()` is only reachable through that
// narrow, documented bypass; the rejection itself is separately proven below
// with ZERO bypass, against the real classifiers.
//
// NOT covered here: sprint-1.md's QA item 3 asks for a TLS spec proving "a
// cert valid for the rebound IP's host does not satisfy the connection"
// against the ORIGINAL hostname. That needs a real HTTPS server presenting a
// certificate for a specific (wrong) hostname, which needs a self-signed
// cert/key pair — this repo has no cert-generation tooling (openssl shell-out
// or a userland lib like `node-forge`/`selfsigned`) as a dependency, and
// adding one for a single LOW-risk spec was judged disproportionate for this
// sprint. The specs below substitute a plain-HTTP `Host`-header check, which
// proves hostname preservation end-to-end but NOT TLS/SNI/cert enforcement
// specifically — that gap is real and stated plainly rather than implied
// covered (cross-agent review + `pr-reviewer` both flagged this; the
// `pr-reviewer` pass separately proved the underlying behaviour correct by
// hand — pinning `www.google.com`'s IP under hostname `example.com` and
// getting `ERR_TLS_CERT_ALTNAME_INVALID` — so the CODE is right, only the
// automated coverage of that specific criterion is missing).

function makeServer(
  handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; hits: Array<{ host: string | undefined }> }> {
  const hits: Array<{ host: string | undefined }> = []
  const server = http.createServer((req, res) => {
    hits.push({ host: req.headers.host })
    if (handler) {
      handler(req, res)
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, port, hits })
    })
  })
}

test.describe('ssrf-fetch · selectPinnedAddresses (pure, no network)', () => {
  test('returns every validated address, tagging family, when none are private — not just the first (preserves Happy-Eyeballs/v4↔v6 failover)', () => {
    const results: ResolvedAddress[] = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]
    expect(selectPinnedAddresses(results)).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])
  })
  test('rejects when ANY resolved address is private/reserved (loopback, link-local, RFC1918)', () => {
    expect(selectPinnedAddresses([{ address: '127.0.0.1', family: 4 }])).toBeNull()
    expect(selectPinnedAddresses([{ address: '169.254.169.254', family: 4 }])).toBeNull() // cloud metadata
    expect(selectPinnedAddresses([{ address: '10.0.0.5', family: 4 }])).toBeNull()
    expect(selectPinnedAddresses([{ address: '::1', family: 6 }])).toBeNull()
    expect(selectPinnedAddresses([{ address: 'fd00::1', family: 6 }])).toBeNull()
    // Public first, private second in the SAME resolve — still rejected (fails closed on ANY).
    expect(
      selectPinnedAddresses([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).toBeNull()
  })
  test('fails closed on an empty result set', () => {
    expect(selectPinnedAddresses([])).toBeNull()
  })
})

test.describe('ssrf-fetch · pinnedFetch rejection (real classifiers, no bypass)', () => {
  test('throws SsrfBlockedError when the resolved address is private', async () => {
    await expect(
      pinnedFetch(new URL('http://internal-target.invalid/'), undefined, {
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })
  test('throws SsrfBlockedError when DNS resolution fails (fails closed)', async () => {
    await expect(
      pinnedFetch(new URL('http://does-not-resolve.invalid/'), undefined, {
        resolve: async () => {
          throw new Error('ENOTFOUND')
        },
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })
  test('unsafeSkipPrivateCheckForTest is structurally refused outside test (NODE_ENV=production)', async () => {
    // `process.env.NODE_ENV` is typed read-only in this repo's tsconfig, so
    // mutate it through a widened view rather than assigning the literal
    // property (which fails `tsc`). Restore it in `finally` either way.
    const env = process.env as Record<string, string | undefined>
    const original = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      await expect(
        pinnedFetch(new URL('http://internal-target.invalid/'), undefined, {
          resolve: async () => [{ address: '127.0.0.1', family: 4 }],
          unsafeSkipPrivateCheckForTest: true,
        }),
      ).rejects.toThrow('unsafeSkipPrivateCheckForTest must never be used in production')
    } finally {
      env.NODE_ENV = original
    }
  })
})

test.describe('ssrf-fetch · pinnedFetch TOCTOU-closure + hostname preservation', () => {
  test('dials the pinned resolve — a hypothetical second (rebound) resolve never happens; the original hostname is what the server sees; the body is read intact', async () => {
    const { server, port, hits } = await makeServer()
    try {
      let resolveCallCount = 0
      // Simulates the classic DNS-rebinding shape: a first answer that would
      // pass validation, then a DIFFERENT address on any later, independent
      // resolve. The OLD resolve-then-fetch pattern (assertPublicHost +
      // plain fetch()) re-resolves inside fetch() itself and could dial
      // whatever THIS second answer is. pinnedFetch must never reach it.
      const resolve = async (): Promise<ResolvedAddress[]> => {
        resolveCallCount += 1
        if (resolveCallCount === 1) return [{ address: '127.0.0.1', family: 4 }]
        // Never legitimately reachable from this test — proves the point if it ever were used.
        return [{ address: '10.6.6.6', family: 4 }]
      }

      const hostname = 'rebind-test.invalid' // RFC 2606 reserved — never really resolvable
      const res = await pinnedFetch(new URL(`http://${hostname}:${port}/`), undefined, {
        resolve,
        unsafeSkipPrivateCheckForTest: true, // see lib/ssrf-fetch.ts header — loopback is the only dialable local target
      })

      expect(res.status).toBe(200)
      expect(resolveCallCount).toBe(1) // the resolver's "second call" branch was never exercised
      expect(hits).toHaveLength(1)
      // The dial went to 127.0.0.1, but the request the server actually
      // received still carries the ORIGINAL hostname (+port) — proving the
      // hostname is preserved end-to-end (this is what preserves TLS
      // SNI/cert validation against the real hostname in the https case;
      // for a plain-HTTP local test the observable proxy for that is the
      // `Host` header — see the describe-block header above for what this
      // does and doesn't prove about TLS specifically).
      expect(hits[0].host).toBe(`${hostname}:${port}`)
      // Fully drain the body (also required so `server.close()` below
      // doesn't hang waiting for an active connection) and assert on its
      // actual content — a status-only assertion would pass even against
      // the premature-`agent.destroy()` bug this regressed on once (see
      // lib/ssrf-fetch.ts's file-header CORRECTION).
      await expect(res.text()).resolves.toBe('ok')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('reads a large (>256KB), multi-chunk, delayed body completely — regression spec for the premature agent.destroy() bug', async () => {
    // Cross-agent review's threshold ladder against real undici 8.8.0 found
    // the premature-destroy bug was a RACE, not a clean cutoff: 1 KB/16 KB
    // bodies passed "by accident" (small enough to arrive in the same flush
    // as the headers), 64 KB/256 KB/1 MB reliably failed. This body is
    // comfortably over that line (384 KB) AND split so the first chunk
    // flushes with the headers while the rest arrives on a later, delayed
    // write — the exact shape that made small-body specs a false negative.
    const CHUNK_SIZE = 64 * 1024
    const CHUNK_COUNT = 6 // 384 KB total
    const chunks = Array.from({ length: CHUNK_COUNT }, (_, i) => Buffer.alloc(CHUNK_SIZE, 65 + (i % 26)))
    const expectedBody = Buffer.concat(chunks)

    const { server, port, hits } = await makeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.write(chunks[0]) // flushes with the headers
      setTimeout(() => {
        for (const c of chunks.slice(1)) res.write(c)
        res.end()
      }, 120) // the rest arrives well after pinnedFetch() has already returned
    })
    try {
      const res = await pinnedFetch(new URL(`http://big-body-test.invalid:${port}/`), undefined, {
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        unsafeSkipPrivateCheckForTest: true,
      })
      expect(res.status).toBe(200)
      const body = Buffer.from(await res.arrayBuffer())
      expect(body.length).toBe(expectedBody.length) // not truncated by a socket destroyed mid-stream
      expect(body.equals(expectedBody)).toBe(true)
      expect(hits).toHaveLength(1)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

// `redirect: 'error'` (ssrf-artwork-url-mcp seed, AC3 — added alongside the
// third pinnedFetch call site, lib/artwork-url-fetch.ts) — a public,
// already-validated host must not be able to pivot the fetch to an
// unvalidated one via a 3xx. This is generic `pinnedFetch` + undici
// behavior, not specific to any one caller, so it lives here with
// `pinnedFetch`'s other mechanics rather than duplicated per call site.
test.describe('ssrf-fetch · pinnedFetch + redirect: "error" (a 3xx is refused, never followed)', () => {
  test('a 302 throws on the FIRST response and the server is only ever hit once — the redirect target is never dialed', async () => {
    // The pinned Agent's `connect.lookup` answers ANY hostname with the SAME
    // validated address set, so even a "followed" redirect to a different
    // hostname would still physically dial the ORIGINAL pinned address — it
    // can't be used to pivot to a genuinely different IP. That means the
    // observable difference `redirect: 'error'` makes isn't "which address
    // gets dialed" but WHETHER a second request happens at all: this handler
    // 302s once then 200s, so counting hits distinguishes "rejected
    // immediately" (1 hit) from "the redirect was followed" (2 hits) —
    // a same-target-count assertion wouldn't, since both land on this same
    // test server either way.
    let hitCount = 0
    const { server, port } = await makeServer((_req, res) => {
      hitCount += 1
      if (hitCount === 1) {
        res.writeHead(302, { location: `http://redirect-test.invalid:${port}/after` })
        res.end()
      } else {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('should never be reached')
      }
    })
    try {
      await expect(
        pinnedFetch(new URL(`http://redirect-test.invalid:${port}/`), { redirect: 'error' }, {
          resolve: async () => [{ address: '127.0.0.1', family: 4 }],
          unsafeSkipPrivateCheckForTest: true, // see file-header note — loopback is the only dialable local target
        }),
      ).rejects.toBeTruthy() // undici throws on a 3xx when redirect: 'error' — never issues the second request
      expect(hitCount).toBe(1)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
