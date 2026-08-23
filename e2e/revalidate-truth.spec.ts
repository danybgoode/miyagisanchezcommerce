import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CACHE } from '../lib/cache-policy'
import { discoverRevalidatedRoutes, revalidateTruthFindings } from '../lib/revalidate-truth'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_SHOP = 'app/(public-read)/internal-public-read/[channel]/[identity]/[slug]/shop/[[...rest]]/page.tsx'
const PUBLIC_LISTING = 'app/(public-read)/internal-public-read/[channel]/[identity]/[slug]/listing/[id]/page.tsx'
const DYNAMIC_PREVIEW = 'app/(public-preview)/internal-owner-preview/mx/s/[slug]/page.tsx'

test.describe('revalidate truth · D7/D9/D12/D19', () => {
  test('public literals match cache-policy and the full server graph is request-neutral', () => {
    expect(revalidateTruthFindings([
      { entry: PUBLIC_SHOP, expectedRevalidate: CACHE.SHOP },
      { entry: PUBLIC_LISTING, expectedRevalidate: CACHE.LISTING },
    ], ROOT)).toEqual([])
    for (const entry of [PUBLIC_SHOP, PUBLIC_LISTING]) {
      expect(revalidateTruthFindings([{ entry }], ROOT)).toEqual([])
      const source = readFileSync(path.join(ROOT, entry), 'utf8')
      expect(source).toMatch(/export function generateStaticParams\(\)\s*\{\s*return \[\]\s*\}/)
    }
  })

  test('a deliberately dynamic route without revalidate is allowed', () => {
    expect(revalidateTruthFindings([{ entry: DYNAMIC_PREVIEW }], ROOT)).toEqual([])
  })

  test('every route that declares revalidate can honour it', () => {
    const routes = discoverRevalidatedRoutes(ROOT)
    expect(routes.length, 'the revalidate declaration scan found nothing').toBeGreaterThan(0)
    expect(revalidateTruthFindings(routes, ROOT)).toEqual([])
  })

  test('the declaration population includes layout segment config, not pages only', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'revalidate-layout-'))
    try {
      const segment = path.join(fixture, 'app', 'segment')
      mkdirSync(segment, { recursive: true })
      writeFileSync(path.join(segment, 'layout.tsx'), 'export const revalidate = 60\nexport default function Layout({ children }) { return children }\n')
      expect(discoverRevalidatedRoutes(fixture)).toEqual([{ entry: 'app/segment/layout.tsx' }])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
