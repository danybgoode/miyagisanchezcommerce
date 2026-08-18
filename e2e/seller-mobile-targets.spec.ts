import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

test.describe('seller mobile controls · durable source guard', () => {
  test('order and catalog selection glyphs live inside 44px targets', () => {
    const orders = read('app/(shell)/shop/manage/orders/OrdersInbox.tsx')
    const catalog = read('app/(shell)/shop/manage/catalogo/CatalogTable.tsx')
    expect(orders).toMatch(/min-h-11 min-w-11[\s\S]{0,260}type="checkbox"/)
    expect(catalog.match(/min-h-11 min-w-11/g)?.length).toBeGreaterThanOrEqual(3)
  })

  test('catalog keeps desktop actions and exposes one mobile Más sheet', () => {
    const catalog = read('app/(shell)/shop/manage/catalogo/CatalogTable.tsx')
    expect(catalog).toContain('hidden items-center justify-end gap-1 md:flex')
    expect(catalog).toContain('Más acciones para')
    expect(catalog).toContain('Acciones del anuncio')
    expect(catalog).toContain('md:hidden')
  })

  test('the named SellWizard controls have a 44px interaction floor', () => {
    const wizard = read('app/(shell)/sell/SellWizard.tsx')
    expect(wizard).toMatch(/min-h-11 items-center gap-1\.5[\s\S]{0,180}is_highlighted/)
    expect(wizard).toMatch(/inline-flex min-h-11[\s\S]{0,220}Quitar/)
    expect(wizard).toMatch(/flex min-h-11 items-center gap-2 mt-2[\s\S]{0,220}priceOnRequest/)
  })
})
