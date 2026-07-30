import { test, expect } from '@playwright/test'
import {
  marketplaceUrl,
  platformMarketRedirectPath,
} from '../lib/market-url'
import {
  HOME_TARGET,
  listingTarget,
  passthroughTarget,
  shopTarget,
} from '../lib/shortlink'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test.describe('one-hop market redirects and tenant isolation', () => {
  test('legacy platform paths land directly on canonical MX paths', () => {
    const matrix: Array<[string, string | null]> = [
      ['/l', '/mx/l'],
      ['/l/', '/mx/l'],
      ['/l/prod_123?ignored=path-only', '/mx/l/prod_123?ignored=path-only'],
      ['/s/tienda', '/mx/s/tienda'],
      ['/s/tienda/c/libros', '/mx/s/tienda/c/libros'],
      ['/mx/l', null],
      ['/mx/s/tienda', null],
      ['/', null],
      ['/c/libros', null],
      ['/g/campana', null],
      ['/account', null],
    ]
    for (const [from, to] of matrix) expect(platformMarketRedirectPath(from), from).toBe(to)
  })

  test('shortlinks target canonical destinations without a second hop', () => {
    expect(HOME_TARGET).toBe('https://miyagisanchez.com/mx')
    expect(listingTarget('prod_123')).toBe('https://miyagisanchez.com/mx/l/prod_123')
    expect(shopTarget('bonsai')).toBe('https://miyagisanchez.com/mx/s/bonsai')
    expect(passthroughTarget('/l/prod_123', '?ref=QR')).toBe('https://miyagisanchez.com/mx/l/prod_123?ref=QR')
    expect(passthroughTarget('/s/bonsai/c/libros', '')).toBe('https://miyagisanchez.com/mx/s/bonsai/c/libros')
    expect(passthroughTarget('/S/Bonsai/c/Libros', '')).toBe('https://miyagisanchez.com/mx/S/Bonsai/c/Libros')
    expect(passthroughTarget('/L/prod_ABC', '')).toBe('https://miyagisanchez.com/mx/L/prod_ABC')
    expect(passthroughTarget('/g/sorteo', '')).toBe('https://miyagisanchez.com/g/sorteo')
  })

  test('shortlinks delegate marketplace URL construction to the shared origin-aware seam', () => {
    const source = readFileSync(join(ROOT, 'lib/shortlink.ts'), 'utf8')
    expect(source).toContain("from './market-url'")
    expect(source).toContain('shopUrlFor(PLATFORM_ORIGIN, slug)')
    expect(source).toContain('listingUrlFor(PLATFORM_ORIGIN, productId)')
    expect(source).toContain("marketplaceUrl(PLATFORM_ORIGIN, '/')")
    expect(source).not.toMatch(/`\$\{PLATFORM_ORIGIN\}\/mx\/[sl]/)
  })

  test('tenant origins never receive a country prefix', () => {
    expect(marketplaceUrl('https://bonsai.miyagisanchez.com', '/l/prod_123')).toBe(
      'https://bonsai.miyagisanchez.com/l/prod_123',
    )
    expect(marketplaceUrl('https://tienda.mx', '/s/bonsai')).toBe('https://tienda.mx/s/bonsai')
    expect(marketplaceUrl('https://miyagisanchez.com', '/l/prod_123')).toBe(
      'https://miyagisanchez.com/mx/l/prod_123',
    )
  })

  test('Stripe post-purchase email uses the origin-aware listing URL seam', () => {
    const source = readFileSync(join(ROOT, 'app/api/webhooks/stripe/route.ts'), 'utf8')
    expect(source).toContain('listingUrlFor(siteBase, product_id)')
    expect(source).not.toContain('`${siteBase}/mx/l/${product_id}`')
  })
})
