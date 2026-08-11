import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

test.describe('market root documents · server-owned language', () => {
  test('the global root is gone so locale-specific root layouts can own html', () => {
    expect(existsSync(path.join(ROOT, 'app/layout.tsx'))).toBe(false)
  })

  test('the shared document renders html lang and Clerk locale from market presentation', () => {
    const document = source('app/components/MarketDocument.tsx')
    expect(document).toContain('resolveMarketPresentation(market)')
    expect(document).toContain('<html lang={presentation.htmlLang}')
    expect(document).toContain("presentation.language === 'en' ? enUS : esMX")
    expect(document).not.toContain('next/headers')
  })

  test('static MX and US roots state their market without request or client inference', () => {
    const mx = source('app/(mx-site)/layout.tsx')
    const us = source('app/(us-site)/layout.tsx')
    expect(mx).toContain('<MarketDocument market="mx">')
    expect(us).toContain('<MarketDocument market="us">')
    expect(us).toContain("marketRootMetadata('us')")
    for (const layout of [mx, us]) {
      expect(layout).not.toContain('next/headers')
      expect(layout).not.toMatch(/document\.documentElement|setAttribute\(['"]lang/)
    }
  })

  test('the current dynamic shell remains explicitly es-MX; S3 owns a sibling US shell', () => {
    const shell = source('app/(shell)/layout.tsx')
    expect(shell).toContain('<MarketDocument market="mx">')
    expect(shell).toContain('<PlatformShell market="mx"')
  })
})
