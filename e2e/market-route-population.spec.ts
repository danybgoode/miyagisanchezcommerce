import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  MARKET_PREFIXED_PATH_FAMILIES,
  isMarketPrefixablePath,
} from '../lib/market-url'

const ROOT = path.resolve(import.meta.dirname, '..')

function filesBelow(relativeDir: string): string[] {
  const root = path.join(ROOT, relativeDir)
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const absolute = path.join(root, entry)
    if (statSync(absolute).isDirectory()) out.push(...filesBelow(path.relative(ROOT, absolute)))
    else if (/\.(?:ts|tsx)$/.test(entry)) out.push(absolute)
  }
  return out
}

test.describe('market route population', () => {
  test('literal MX routes share the legacy page system while tenant routes remain present', () => {
    const required = [
      'app/(site)/page.tsx',
      'app/(site)/mx/page.tsx',
      'app/(site)/us/page.tsx',
      'app/(shell)/l/[id]/page.tsx',
      'app/(shell)/s/[slug]/page.tsx',
      'app/(shell)/c/[collection]/page.tsx',
      'app/(shell)/mx/l/page.tsx',
      'app/(shell)/mx/l/[id]/page.tsx',
      'app/(shell)/mx/s/[slug]/page.tsx',
    ]
    for (const file of required) expect(existsSync(path.join(ROOT, file)), file).toBe(true)

    expect(existsSync(path.join(ROOT, 'app/(shell)/mx/c/[collection]/page.tsx'))).toBe(false)
    expect(MARKET_PREFIXED_PATH_FAMILIES).toEqual(['/l', '/s'])
    expect(isMarketPrefixablePath('/c/editorial')).toBe(false)
  })

  test('the root selector is a zero-catalog static surface', () => {
    const source = readFileSync(path.join(ROOT, 'app/(site)/page.tsx'), 'utf8')
    expect(source).toContain('data-testid="market-selector"')
    expect(source).toContain("href: marketBasePath('mx')")
    expect(source).toContain("href: marketBasePath('us')")
    expect(source).not.toMatch(/from ['"]@\/lib\/(?:listings|medusa|supabase)['"]/)
    expect(source).not.toMatch(/export const revalidate\s*=/)
  })

  test('platform-emitted absolute URLs never point at redirect sources', () => {
    const offenders = filesBelow('app').concat(filesBelow('lib')).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return /https:\/\/miyagisanchez\.com\/(?:l|s)(?:\/|['"`])|miyagisanchez\.com\/s\//.test(source)
        ? [path.relative(ROOT, file)]
        : []
    })
    expect(offenders).toEqual([])
  })

  test('platform component links never point at bare marketplace redirect sources', () => {
    const offenders = filesBelow('app').flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return /href="\/l"|href=\{`\/l\/|href=\{`\/s\//.test(source)
        ? [path.relative(ROOT, file)]
        : []
    })
    expect(offenders).toEqual([])
  })

  test('seller management success surfaces emit canonical marketplace shop URLs', () => {
    const expected = [
      'app/(shell)/shop/manage/import/ImportClient.tsx',
      'app/(shell)/shop/manage/convocatoria/page.tsx',
      'app/(shell)/shop/manage/comparte/ComparteClient.tsx',
    ]
    for (const file of expected) {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).toContain('/mx/s/')
      expect(source, file).not.toMatch(/(?:liveUrl|shareUrl|publicUrl)=\{?`?\/s\//)
    }
    const comparte = readFileSync(
      path.join(ROOT, 'app/(shell)/shop/manage/comparte/ComparteClient.tsx'),
      'utf8',
    )
    expect(comparte).not.toMatch(/(?:^|\s)\/s\/\{shopSlug\}/)
  })

  test('every literal MX shop route passes a market decision, not only a URL prefix', () => {
    const wrappers = filesBelow('app/(shell)/mx/s')
      .filter((file) => file.endsWith('/page.tsx'))
    expect(wrappers.length).toBeGreaterThan(5)
    const offenders = wrappers
      .filter((file) => !readFileSync(file, 'utf8').includes("market: 'mx'"))
      .map((file) => path.relative(ROOT, file))
    expect(offenders).toEqual([])
  })
})
