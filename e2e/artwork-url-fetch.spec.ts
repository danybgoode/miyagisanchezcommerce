import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadArtworkBytes, readCappedBody } from '../lib/artwork-url-fetch'
import type { ResolvedAddress } from '../lib/ssrf-fetch'

/**
 * SSRF hardening for POST /api/ucp/mcp's `create_checkout` `artwork_url`
 * (Roadmap/00-ideas/seeds/ssrf-artwork-url-mcp.md — filed as the THIRD
 * pinnedFetch adoption site after ssrf-dns-pinning Sprint 1's two). Unlike
 * those two, this call site has NO auth at all (`create_checkout` is in
 * `MCP_BUYER_TOOLS`) and previously accepted `http://`, followed redirects,
 * and only checked an advisory `content-length` header before an unbounded
 * `arrayBuffer()` read — see the seed's exposure table for the full
 * before-picture.
 *
 * `app/api/ucp/mcp/route.ts`'s `handleCreateConfiguredCheckout` only reaches
 * the artwork_url branch for a listing with a real configurator `price_grid`
 * AND a real `file` custom field — no such listing is seeded in every
 * environment (same gap `e2e/mcp-configured-checkout.spec.ts`'s own header
 * documents), so this unit-tests `lib/artwork-url-fetch.ts` directly rather
 * than round-tripping through the MCP endpoint — exactly the same restraint
 * `e2e/shop-url-analyzer.spec.ts` / `e2e/comparador-analyze-route.spec.ts`
 * take with the sibling analyzer fetch (no live third-party request from
 * CI, no flakiness). The redirect mechanism itself (`pinnedFetch` +
 * `redirect: 'error'`) is generic, not artwork-specific, so it's proven once
 * in `e2e/migrations-mapper.spec.ts`'s ssrf-fetch section instead of here.
 *
 * The route's "collapse to ONE generic message" property is pinned at the
 * bottom of this file via a static source check — the message text itself
 * lives at the route's single call site, not in this lib.
 */

test.describe('downloadArtworkBytes · scheme gate (AC1 — http:// refused before any network call)', () => {
  test('an http:// artwork_url is refused before pinnedFetch ever resolves DNS', async () => {
    let resolveCalls = 0
    const result = await downloadArtworkBytes(
      'http://169.254.169.254/latest/meta-data/',
      10 * 1024 * 1024,
      { resolve: async (): Promise<ResolvedAddress[]> => { resolveCalls += 1; return [{ address: '93.184.216.34', family: 4 }] } },
    )
    expect(result).toEqual({ ok: false })
    // The resolver is only ever invoked from inside pinnedFetch — zero calls
    // proves the scheme check short-circuits BEFORE any DNS/network attempt.
    expect(resolveCalls).toBe(0)
  })

  test('a non-URL string is refused, never throws', async () => {
    await expect(downloadArtworkBytes('not a url at all', 1024)).resolves.toEqual({ ok: false })
  })

  test('a non-https, non-http scheme (e.g. file:) is also refused, not just http:', async () => {
    const result = await downloadArtworkBytes('file:///etc/passwd', 1024)
    expect(result).toEqual({ ok: false })
  })
})

test.describe('downloadArtworkBytes · private/reserved host (AC2)', () => {
  test('a host resolving to a private/reserved address is refused, generic ok:false only — no host/status/reason leaked', async () => {
    const result = await downloadArtworkBytes(
      'https://internal-target.invalid/x',
      10 * 1024 * 1024,
      { resolve: async () => [{ address: '169.254.169.254', family: 4 }] },
    )
    expect(result).toEqual({ ok: false })
  })

  test('a cloud-metadata-shaped host (169.254.169.254) resolving to itself is refused', async () => {
    const result = await downloadArtworkBytes(
      'https://metadata.internal-shop.invalid/latest/meta-data/',
      10 * 1024 * 1024,
      { resolve: async () => [{ address: '169.254.169.254', family: 4 }] },
    )
    expect(result).toEqual({ ok: false })
  })

  test('DNS resolution failure is refused too (fails closed) — same shape as a private-address rejection', async () => {
    const result = await downloadArtworkBytes(
      'https://does-not-resolve.invalid/x',
      10 * 1024 * 1024,
      { resolve: async () => { throw new Error('ENOTFOUND') } },
    )
    expect(result).toEqual({ ok: false })
  })
})

test.describe('readCappedBody · streamed byte cap (AC4 — a lying/absent content-length cannot push more than the cap into memory)', () => {
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    let i = 0
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(chunks[i])
          i += 1
        } else {
          controller.close()
        }
      },
    })
  }

  test('a body under the cap reads through completely', async () => {
    const chunk = new Uint8Array(1000).fill(7)
    const bytes = await readCappedBody(streamOf([chunk]), 2000)
    expect(bytes).not.toBeNull()
    expect(bytes!.byteLength).toBe(1000)
  })

  test('a body that crosses the cap mid-stream is refused entirely, never partially buffered', async () => {
    // Simulates a response that LIES about (or omits) content-length and
    // just keeps streaming — the real defense here is never trusting a
    // header, only the running total of bytes actually read off the wire.
    const maxBytes = 1000
    const chunkA = new Uint8Array(600).fill(1)
    const chunkB = new Uint8Array(600).fill(2) // 600 + 600 = 1200 > 1000 cap
    const bytes = await readCappedBody(streamOf([chunkA, chunkB]), maxBytes)
    expect(bytes).toBeNull()
  })

  test('an effectively unbounded stream is cut off at the cap, not read to completion', async () => {
    const maxBytes = 5000
    let pulls = 0
    const hugeStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1000).fill(9)) // would total 1,000,000+ bytes if ever fully read
        if (pulls > 10_000) controller.close() // safety valve only — the cap must stop this long before here
      },
    })
    const bytes = await readCappedBody(hugeStream, maxBytes)
    expect(bytes).toBeNull()
    // Cap (5000) is crossed partway through the 6th 1000-byte chunk — proves
    // the reader stopped pulling near the cap instead of draining the whole
    // attacker-controlled stream into memory first.
    expect(pulls).toBeLessThan(10)
  })
})

test.describe('app/api/ucp/mcp/route.ts · artwork_url oracle collapse (AC5 — one generic message, no reachability/status/network leak)', () => {
  test('the three old distinguishable error strings are gone, and exactly one generic message covers every download/validation failure', async () => {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url))
    const src = await readFile(path.join(repoRoot, 'app/api/ucp/mcp/route.ts'), 'utf8')

    // Pre-fix oracle: a status code, a content-length-derived size, and a raw
    // network-error string each told an anonymous caller something different
    // about an internal host. None of these may reappear at this call site.
    expect(src).not.toContain('Could not download artwork_url')
    expect(src).not.toContain('Artwork exceeds the')
    expect(src).not.toContain('Network error downloading artwork_url')

    // The replacement is a single named constant, used exactly once as the
    // artwork_url failure branch's message — not re-derived per failure cause.
    const definitionCount = (src.match(/const ARTWORK_DOWNLOAD_ERROR = /g) ?? []).length
    const usageCount = (src.match(/text: ARTWORK_DOWNLOAD_ERROR/g) ?? []).length
    expect(definitionCount).toBe(1)
    expect(usageCount).toBe(1)
  })

  test('the artwork_url fetch is routed through downloadArtworkBytes (pinnedFetch), not a bare global fetch', async () => {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url))
    const src = await readFile(path.join(repoRoot, 'app/api/ucp/mcp/route.ts'), 'utf8')
    expect(src).toContain(`import { downloadArtworkBytes } from '@/lib/artwork-url-fetch'`)
    expect(src).toContain('await downloadArtworkBytes(')
  })
})
