import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const repoRoot = process.cwd()
const manageRoot = join(repoRoot, 'app', '(shell)', 'shop', 'manage')

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pageFiles(path)
    return entry.name === 'page.tsx' ? [path] : []
  })
}

function loadingBoundaryFor(page: string): string | null {
  let cursor = dirname(page)
  while (cursor.startsWith(manageRoot)) {
    const candidate = join(cursor, 'loading.tsx')
    if (existsSync(candidate)) return candidate
    if (cursor === manageRoot) break
    cursor = dirname(cursor)
  }
  return null
}

test.describe('seller loading boundaries', () => {
  test('every current and future manage page reaches a loading boundary', () => {
    const pages = pageFiles(manageRoot)
    expect(pages.length).toBeGreaterThan(0)
    const uncovered = pages
      .filter((page) => !loadingBoundaryFor(page))
      .map((page) => relative(repoRoot, page))
    expect(uncovered, `Seller pages without a loading boundary:\n${uncovered.join('\n')}`).toEqual([])
  })

  test('every seller loading boundary uses the shared truthful skeleton', () => {
    const boundaries = [
      join(manageRoot, 'loading.tsx'),
      join(manageRoot, 'orders', 'loading.tsx'),
      join(manageRoot, 'orders', '[id]', 'loading.tsx'),
      join(manageRoot, 'catalogo', 'loading.tsx'),
      join(manageRoot, 'settings', 'loading.tsx'),
      join(repoRoot, 'app', '(shell)', 'sell', 'loading.tsx'),
    ]
    for (const boundary of boundaries) {
      expect(readFileSync(boundary, 'utf8')).toContain('SellerPageSkeleton')
    }
    const skeleton = readFileSync(join(repoRoot, 'components', 'seller', 'SellerPageSkeleton.tsx'), 'utf8')
    expect(skeleton).toContain('className={`skeleton')
    expect(skeleton).not.toMatch(/\b(?:percent|porcentaje|spinner)\b/i)
  })
})
