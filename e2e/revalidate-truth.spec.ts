import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CACHE } from '../lib/cache-policy'
import { revalidateTruthFindings } from '../lib/revalidate-truth'

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
  })

  test('a deliberately dynamic route without revalidate is allowed', () => {
    expect(revalidateTruthFindings([{ entry: DYNAMIC_PREVIEW }], ROOT)).toEqual([])
  })
})
