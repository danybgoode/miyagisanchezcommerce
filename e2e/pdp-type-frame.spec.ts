import { test, expect } from '@playwright/test'
import { listingTypeFrame, LISTING_TYPE_FILTERS } from '../lib/listing-query'

/**
 * Discovery Polish · Sprint 3 — PDP decision frame (S3.1), pure-logic, in the
 * `api` gate. `listingTypeFrame` is the single source of the type-appropriate
 * lead the PDP renders first; the browser spec (pdp-hierarchy) asserts it
 * actually paints, this proves the mapping.
 */
test.describe('pdp · listingTypeFrame', () => {
  test('non-product types lead with an es-MX label + hint + icon', () => {
    const service = listingTypeFrame('service')
    expect(service).toMatchObject({ label: 'Servicio', hint: 'Solicita o agenda con el vendedor', icon: 'iconoir-calendar' })
    expect(listingTypeFrame('rental')?.label).toBe('Renta')
    expect(listingTypeFrame('digital')?.hint).toBe('Entrega automática al instante')
    expect(listingTypeFrame('subscription')?.label).toBe('Suscripción')
  })

  test('product (the default) and unknown/empty get no frame — the buy box leads', () => {
    expect(listingTypeFrame('product')).toBeNull()
    expect(listingTypeFrame('')).toBeNull()
    expect(listingTypeFrame(null)).toBeNull()
    expect(listingTypeFrame('wat')).toBeNull()
  })

  test('every non-product chip value yields a complete frame', () => {
    for (const { value } of LISTING_TYPE_FILTERS) {
      if (value === 'product') {
        expect(listingTypeFrame(value)).toBeNull()
      } else {
        const frame = listingTypeFrame(value)
        expect(frame?.label).toBeTruthy()
        expect(frame?.hint).toBeTruthy()
        expect(frame?.icon).toMatch(/^iconoir-/)
      }
    }
  })
})
