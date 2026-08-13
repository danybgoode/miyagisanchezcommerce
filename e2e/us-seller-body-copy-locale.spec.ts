import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const ROOT = path.resolve(import.meta.dirname, '..')
const source = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), 'utf8')

test('seller body copy is a complete market-derived transform and MX remains the original', async () => {
  const transformPath = path.join(ROOT, 'lib/seller-copy.ts')
  const populationPath = path.join(ROOT, 'scripts/derive-seller-locale-population.ts')

  // This assertion is deliberately first: the spec was observed red while the
  // transform did not exist, before any implementation was added.
  expect(existsSync(transformPath)).toBe(true)
  expect(existsSync(populationPath)).toBe(true)

  const [{ deriveSellerLocalePopulation, serializeSellerLocalePopulation }, sellerCopy] = await Promise.all([
    import('../scripts/derive-seller-locale-population'),
    import('../lib/seller-copy'),
  ])
  const es = JSON.parse(source('locales/es.json')) as { sellerCopy: Record<string, string> }
  const en = JSON.parse(source('locales/en.json')) as { sellerCopy: Record<string, string> }
  const population = deriveSellerLocalePopulation(ROOT)

  expect(population.direct.length).toBeGreaterThan(100)
  expect(population.entries.length).toBeGreaterThan(500)
  expect(population.direct).toContain('app/(shell)/shop/manage/ManageDashboard.tsx')
  expect(population.direct).toContain('app/(shell)/sell/SellWizard.tsx')
  expect(population.entries.map(({ source }) => source)).toEqual(expect.arrayContaining([
    'Pago pendiente',
    'Sin uso, en empaque original',
    'Error al subir. Toca para reintentar.',
    'Guardar cambios',
  ]))
  expect(source('locales/seller-population.json')).toBe(serializeSellerLocalePopulation(population))

  const expectedKeys = population.entries.map(({ key }) => key).sort()
  expect(Object.keys(es.sellerCopy).sort()).toEqual(expectedKeys)
  expect(Object.keys(en.sellerCopy).sort()).toEqual(expectedKeys)
  for (const { key, source: original } of population.entries) {
    expect(es.sellerCopy[key]).toBe(original)
    expect(new Set(en.sellerCopy[key].match(/\{\d+\}/g) ?? [])).toEqual(
      new Set(original.match(/\{\d+\}/g) ?? []),
    )
  }

  for (const brand of ['Miyagi Sánchez', 'Mercado Libre', 'Mercado Pago', 'MercadoPago', 'Stripe', 'WhatsApp']) {
    for (const { key, source: original } of population.entries.filter(({ source }) => source.includes(brand))) {
      expect(en.sellerCopy[key], `${brand} changed in ${original}`).toContain(brand)
    }
  }

  const copy = sellerCopy.createSellerCopyTransform(population.entries, en.sellerCopy)
  expect(copy('Guardar cambios', 'mx')).toBe('Guardar cambios')
  expect(copy('Guardar cambios', 'us')).toBe('Save changes')
  expect(copy('Importar catálogo', 'us')).toBe('Import catalog')
  expect(copy('Crea una nueva API key (nombre: “Miyagi Sánchez”)', 'us')).toBe(
    'Create a new API key (name: “Miyagi Sánchez”)',
  )
  expect(copy('Mercado Libre', 'us')).toBe('Mercado Libre')
  expect(copy('Stripe · MercadoPago · WhatsApp', 'us')).toBe('Stripe · MercadoPago · WhatsApp')
  expect(copy('Sin traducir', 'mx')).toBe('Sin traducir')

  const attributes = { href: '/shop/manage', icon: 'iconoir-shop', key: 'shop', title: 'Guardar cambios' }
  expect(sellerCopy.localizeSellerAttributes(attributes, 'mx', copy)).toEqual(attributes)
  expect(sellerCopy.localizeSellerAttributes(attributes, 'us', copy)).toEqual({
    href: '/shop/manage',
    icon: 'iconoir-shop',
    key: 'shop',
    title: 'Save changes',
  })

  const manageLayout = source('app/(shell)/shop/manage/layout.tsx')
  const sellLayout = source('app/(shell)/sell/layout.tsx')
  const boundary = source('app/components/SellerCopyBoundary.tsx')
  for (const layout of [manageLayout, sellLayout]) {
    expect(layout).toContain('getMySeller()')
    expect(layout).toContain('seller?.market')
    expect(layout).toContain('SellerCopyBoundary')
    expect(layout).toContain("if (market !== 'us') return content")
  }
  const sellPage = source('app/(shell)/sell/page.tsx')
  expect(sellPage).toContain('resolveSellerSignupMarket(marketParam)')
  expect(sellPage).not.toMatch(/normalizeLocale|accept-language/i)
  expect(boundary).not.toMatch(/normalizeLocale|accept-language/i)
})
