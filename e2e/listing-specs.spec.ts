import { test, expect } from '@playwright/test'
import { listingSpecs, attributeSchema } from '../lib/listing-attributes'
import { toUcpListing } from '../lib/ucp/schema'
import type { Listing } from '../lib/types'

/**
 * S3 — structured attributes primitive + scannable specs table.
 * Pure-logic gate for `listingSpecs` (PDP table + UCP read derive from it) and
 * its presence in the UCP catalog payload (AGENTS rule #3).
 */

function listing(category: string, attrs: Record<string, unknown>): Listing {
  return {
    id: 'prod_specs_1',
    shop_id: 'shop_1',
    medusa_product_id: 'prod_specs_1',
    title: 'Anuncio de prueba',
    description: 'Descripción',
    price_cents: 150000,
    currency: 'MXN',
    condition: 'good',
    listing_type: 'product',
    category,
    state: 'Jalisco',
    municipio: 'Guadalajara',
    location: 'Guadalajara, Jalisco',
    attrs,
    metadata: { attrs },
    images: [{ url: 'https://example.com/a.jpg', alt: 'A' }],
    tags: [],
    status: 'active',
    source_platform: null,
    source_url: null,
    views: 0,
    manage_inventory: false,
    available_quantity: null,
    in_stock: true,
    created_at: new Date().toISOString(),
  } as Listing
}

test.describe('listingSpecs', () => {
  test('autos: resolves select labels + appends units, in schema order', () => {
    const specs = listingSpecs(listing('autos', {
      make: 'Toyota',
      year: '2020',
      km: '45000',
      fuel_type: 'gasolina',
      transmission: 'automatico',
      color: 'Blanco',
    }))

    // schema order: make, model, year, km, fuel_type, transmission, color
    expect(specs.map(s => s.label)).toEqual([
      'Marca', 'Año', 'Kilometraje', 'Combustible', 'Transmisión', 'Color',
    ])
    const byLabel = Object.fromEntries(specs.map(s => [s.label, s.value]))
    expect(byLabel['Kilometraje']).toBe('45,000 km')       // km grouped
    expect(byLabel['Combustible']).toBe('Gasolina')        // value slug → label
    expect(byLabel['Transmisión']).toBe('Automático')
    expect(byLabel['Año']).toBe('2020')                    // years never grouped
  })

  test('inmuebles: superficie carries m² unit; tipo resolves label', () => {
    const specs = listingSpecs(listing('inmuebles', {
      property_type: 'departamento',
      area_m2: '65',
      bedrooms: '2',
    }))
    const byLabel = Object.fromEntries(specs.map(s => [s.label, s.value]))
    expect(byLabel['Tipo de inmueble']).toBe('Departamento')
    expect(byLabel['Superficie']).toBe('65 m²')
    expect(byLabel['Recámaras']).toBe('2')
  })

  test('generic category renders brand/color when present', () => {
    const specs = listingSpecs(listing('hogar', { brand: 'IKEA', color: 'Roble' }))
    expect(specs).toEqual([
      { label: 'Marca', value: 'IKEA' },
      { label: 'Color', value: 'Roble' },
    ])
  })

  test('service listing OUTSIDE servicios category still gets service specs', () => {
    // AttrsSection renders the service panel for ANY listingType==='service'
    // (e.g. a class under `cursos`); specs must mirror that, not the generic schema.
    const l = listing('cursos', { modality: 'online', duration: '2 hrs', experience_years: '5' })
    l.listing_type = 'service'
    const byLabel = Object.fromEntries(listingSpecs(l).map(s => [s.label, s.value]))
    expect(byLabel['Modalidad']).toBe('Online / Remoto')
    expect(byLabel['Duración estimada']).toBe('2 hrs')
    expect(byLabel['Años de experiencia']).toBe('5 años')
  })

  test('digital / subscription listings expose no generic specs (event block is separate)', () => {
    const d = listing('cursos', { event_date: '2026-07-01' })
    d.listing_type = 'digital'
    expect(listingSpecs(d)).toEqual([])
    const s = listing('comunidad', { brand: 'X' })
    s.listing_type = 'subscription'
    expect(listingSpecs(s)).toEqual([])
  })

  test('listing with no attrs yields no specs (no empty table)', () => {
    expect(listingSpecs(listing('autos', {}))).toEqual([])
  })

  test('unknown / uncurated category yields no specs', () => {
    expect(attributeSchema('not_a_category')).toEqual([])
    expect(listingSpecs(listing('not_a_category', { make: 'X' }))).toEqual([])
  })

  test('reads attrs from metadata.attrs when typed field absent', () => {
    const l = listing('moda', {})
    delete (l as { attrs?: unknown }).attrs
    l.metadata = { attrs: { size: 'm', color: 'Negro' } }
    const byLabel = Object.fromEntries(listingSpecs(l).map(s => [s.label, s.value]))
    expect(byLabel['Talla']).toBe('M')   // slug 'm' → display 'M'
    expect(byLabel['Color']).toBe('Negro')
  })
})

test.describe('UCP catalog exposes labeled specs (AGENTS rule #3)', () => {
  test('toUcpListing carries the derived specs array', () => {
    const ucp = toUcpListing(listing('autos', { make: 'Honda', year: '2019' }), 'https://miyagisanchez.com')
    expect(Array.isArray(ucp.specs)).toBe(true)
    const byLabel = Object.fromEntries(ucp.specs.map(s => [s.label, s.value]))
    expect(byLabel['Marca']).toBe('Honda')
    expect(byLabel['Año']).toBe('2019')
  })

  test('listing without attrs has an empty specs array', () => {
    const ucp = toUcpListing(listing('otros', {}), 'https://miyagisanchez.com')
    expect(ucp.specs).toEqual([])
  })

  test('rental exposes its pricing semantics (rate_period + deposit) so an agent does not quote the per-period rate as the full price (S4.2)', () => {
    const l = listing('herramientas', { rate_period: 'semana', deposit: '2000' })
    l.listing_type = 'rental'
    const ucp = toUcpListing(l, 'https://miyagisanchez.com')
    expect(ucp.rental).toEqual({ rate_period: 'semana', deposit_cents: 200000 }) // pesos → cents
  })

  test('rental with no captured period/deposit defaults safely; non-rentals carry no rental block', () => {
    const r = listing('otros', {})
    r.listing_type = 'rental'
    expect(toUcpListing(r, 'https://miyagisanchez.com').rental).toEqual({ rate_period: 'dia', deposit_cents: 0 })
    expect(toUcpListing(listing('otros', {}), 'https://miyagisanchez.com').rental).toBeNull()
  })
})
