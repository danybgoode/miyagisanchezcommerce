import { expect, test } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * hyper-performant-website S1 — the seed for the Sprint-1 acceptance checks
 * (bucket Cache-Control, responsive/sized image delivery, first-row LCP
 * priority, no hotlinked images in the live import path). Hardened in S2.3
 * with an actual payload-size budget once the CSS/JS work lands.
 *
 * Two layers, deliberately:
 *   1. Source-code assertions (like dockerfile-lockfile.spec.ts /
 *      frontend-build-args.spec.ts) — pure fs-read/regex, no network, no
 *      credentials, no live deploy needed. This is what makes the spec
 *      pass BEFORE this PR is deployed anywhere (the worktree has no R2/
 *      Medusa credentials to hit a live environment with).
 *   2. One live round-trip, gated exactly like static-shell-split.spec.ts /
 *      home-static.spec.ts's "derive non-emptiness from the environment"
 *      pattern: skip gracefully if the running target doesn't have this
 *      code yet (pre-merge, hitting prod) or has no listings to render —
 *      becomes a real check once the PR's own preview/prod serves it.
 */

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

test.describe('perf-budget · source-code checks (deterministic, no network)', () => {
  test('the custom next/image loader targets the self-hosted /api/img proxy', () => {
    const loader = read('lib/image-loader.ts')
    expect(loader).toMatch(/\/api\/img\?/)
    expect(loader).toMatch(/url:\s*src/)
    expect(loader).toMatch(/w:\s*String\(width\)/)
  })

  test('next.config.ts registers the custom loader (bypasses the broken /_next/image route)', () => {
    const cfg = read('next.config.ts')
    expect(cfg).toMatch(/loader:\s*'custom'/)
    expect(cfg).toMatch(/loaderFile:\s*'.\/lib\/image-loader\.ts'/)
  })

  test('/api/img validates the source host against an allow-list (no open SSRF proxy)', () => {
    const route = read('app/api/img/route.ts')
    expect(route).toMatch(/allowedHosts/)
    expect(route).toMatch(/hosts\.has\(parsed\.hostname\)/)
    expect(route).toMatch(/protocol !== 'https:'/)
  })

  test('/api/img sets a long-lived, immutable Cache-Control on every response', () => {
    const route = read('app/api/img/route.ts')
    expect(route).toMatch(/Cache-Control['"]?:\s*['"]public, max-age=31536000, immutable['"]/)
  })

  test('/api/img refuses to follow redirects from the origin fetch (no allow-list bypass via 3xx)', () => {
    const route = read('app/api/img/route.ts')
    // Scoped to the actual fetch() call, not just "the string exists somewhere" —
    // the surrounding comment also explains WHY, which would let a bare
    // substring check pass even if the option were ever dropped from the call.
    const fetchCall = route.match(/upstream = await fetch\([\s\S]*?\)\)/)?.[0]
    expect(fetchCall, 'expected the upstream fetch() call in /api/img').toBeTruthy()
    expect(fetchCall).toMatch(/redirect:\s*'error'/)
  })

  test('/api/img snaps quality to a small fixed ladder, not a free 40-90 range (DoS-amplification guard)', () => {
    const route = read('app/api/img/route.ts')
    expect(route).toMatch(/QUALITY_LADDER\s*=\s*\[60,\s*75,\s*90\]/)
    expect(route).toMatch(/const quality = snapQuality\(/)
  })

  test('new R2 uploads get a long-lived Cache-Control at the object level', () => {
    const r2 = read('lib/r2.ts')
    expect(r2).toMatch(/CacheControl:\s*'public, max-age=31536000, immutable'/)
  })

  test('the homepage LCP element (Selección featured card) uses next/image with priority', () => {
    const page = read('app/(site)/page.tsx')
    expect(page).toMatch(/import Image from 'next\/image'/)
    const featuredBlock = page.slice(page.indexOf('Featured card'), page.indexOf('Grid — price 16px'))
    expect(featuredBlock).not.toMatch(/<img\s/)
    // Assert `priority`/`sizes` INSIDE the captured <Image ... /> tag itself, not
    // just "somewhere in this block" — the block also contains a prose comment
    // that says the word "priority" (explaining why), which would let this pass
    // even if the actual JSX attribute were ever deleted. Scoping to the tag
    // closes that gap.
    const imageTag = featuredBlock.match(/<Image\b[\s\S]*?\/>/)?.[0]
    expect(imageTag, 'expected a self-closing <Image ... /> tag in the featured-card block').toBeTruthy()
    expect(imageTag).toMatch(/\bpriority\b/)
    expect(imageTag).toMatch(/\bsizes=/)
  })

  test('the Selección grid marks only the first row (idx < 2) as priority', () => {
    const page = read('app/(site)/page.tsx')
    const gridBlock = page.slice(page.indexOf('Grid — price 16px'), page.indexOf('Categorías —'))
    expect(gridBlock).not.toMatch(/<img\s/)
    // Same tag-scoping as the featured-card check above.
    const imageTag = gridBlock.match(/<Image\b[\s\S]*?\/>/)?.[0]
    expect(imageTag, 'expected a self-closing <Image ... /> tag in the grid block').toBeTruthy()
    expect(imageTag).toMatch(/priority=\{idx < 2\}/)
  })

  test('supply-import ingests hotlinked images into R2 before creating a listing', () => {
    const supplyImport = read('lib/supply-import.ts')
    expect(supplyImport).toMatch(/ingestImageUrls/)
    // Anchor on the actual CALL (`await ingestImageUrls(`), not just the bare
    // function name — a doc comment right above the call site also names
    // `ingestImageUrls(` in prose, which `indexOf('ingestImageUrls(')` alone
    // would happily match first even if the real call were ever removed.
    const ingestIdx = supplyImport.indexOf('await ingestImageUrls(')
    const bodyIdx = supplyImport.indexOf('supplyItemToProductBody(itemForCreate')
    expect(ingestIdx).toBeGreaterThan(-1)
    expect(bodyIdx).toBeGreaterThan(-1)
    expect(ingestIdx).toBeLessThan(bodyIdx)
  })

  test('a hotlinked-image backfill script exists for pre-existing listings', () => {
    // Full correctness of a script needing live prod credentials can't be
    // asserted here (see the script's own header) — this just guards against
    // the file silently disappearing/being renamed out from under the sprint doc.
    const script = read('scripts/backfill-hotlinked-images.mjs')
    expect(script).toMatch(/images_mode.*replace/)
    expect(script).toMatch(/--apply/)
  })
})

test.describe('perf-budget · live check (skips gracefully pre-deploy / empty catalog)', () => {
  test('first-row homepage image URLs carry sizing params and long-lived cache headers', async ({ request }) => {
    const homeRes = await request.get('/', { headers: { Accept: 'text/html' } })
    test.skip(!homeRes.ok(), 'homepage not reachable in this environment')
    const html = await homeRes.text()

    const match = html.match(/\/api\/img\?url=[^"'\s]+w=\d+[^"'\s]*/)
    test.skip(!match, 'no /api/img-sourced image found yet in this environment (pre-deploy, or empty catalog)')

    const imgUrl = match![0].replace(/&amp;/g, '&')
    expect(imgUrl).toMatch(/[?&]w=\d+/)

    const imgRes = await request.get(imgUrl)
    expect(imgRes.ok()).toBeTruthy()
    expect(imgRes.headers()['content-type'] ?? '').toMatch(/^image\//)
    expect(imgRes.headers()['cache-control'] ?? '').toContain('max-age=31536000')
    expect(imgRes.headers()['cache-control'] ?? '').toContain('immutable')
  })
})
