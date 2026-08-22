import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const middleware = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8')

test.describe('public read middleware boundary · D7/D9/D10/D11', () => {
  test('direct internal paths fail no-store before host classification', () => {
    const guard = middleware.indexOf('if (isInternalPublicPath(req.nextUrl.pathname))')
    const host = middleware.indexOf("const hostname = req.headers.get('host')")
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(host)
    expect(middleware.slice(guard, host)).toContain("'Cache-Control': 'private, no-store, max-age=0'")
  })

  test('all three admitted channels import the locked eligibility rule before rewrite', () => {
    expect(middleware).toContain('subdomainPublicReadCandidate(req.nextUrl.pathname, req.nextUrl.search)')
    expect(middleware).toContain('embedPublicReadCandidate(req.nextUrl.pathname, req.nextUrl.search)')
    expect(middleware).toContain('marketplacePublicReadCandidate(req.nextUrl.pathname, req.nextUrl.search)')
    expect(middleware.match(/await publicReadEligibility\(/g)?.length).toBe(4)
    expect(middleware.match(/url\.pathname = publicReadPath\(/g)?.length).toBe(4)
  })

  test('custom domains exit before marketplace public-read classification', () => {
    const custom = middleware.indexOf('if (!isPlatformHost(hostname))')
    const marketplace = middleware.indexOf('const publicCandidate = marketplacePublicReadCandidate')
    expect(custom).toBeGreaterThan(0)
    expect(custom).toBeLessThan(marketplace)
  })
})
