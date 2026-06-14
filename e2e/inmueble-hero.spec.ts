import { test, expect } from '@playwright/test'
import { inmuebleHeroModel, inmuebleIconSpecs, zoneMapUrl } from '../lib/inmueble-hero'

/**
 * PDP redesign (epic 01) — Sprint 5, S5.2 (inmuebles).
 *
 * Pure-logic gate for the property hero. No network / no `next/*` — runs in the
 * `api` gate. The PDP renders the models these return, so "lead with icon specs +
 * approximate-zone map + primary Agendar visita" is spec-provable.
 */

test.describe('inmueble-hero · icon spec row (S5.2)', () => {
  test('builds rec · baños · m² · estac. in a fixed order, m² grouped', () => {
    const specs = inmuebleIconSpecs({ area_m2: '1200', bedrooms: '3', parking_spots: '2', bathrooms: '2' })
    expect(specs.map(s => s.label)).toEqual(['Recámaras', 'Baños', 'Superficie', 'Estac.'])
    expect(specs.find(s => s.label === 'Superficie')!.value).toBe('1,200 m²')
    expect(specs.find(s => s.label === 'Recámaras')!.value).toBe('3')
    expect(specs.find(s => s.label === 'Recámaras')!.icon).toBe('iconoir-bed')
  })

  test('skips absent values; all-empty yields []', () => {
    expect(inmuebleIconSpecs({ bedrooms: '2' }).map(s => s.label)).toEqual(['Recámaras'])
    expect(inmuebleIconSpecs({})).toEqual([])
    expect(inmuebleIconSpecs(null)).toEqual([])
    expect(inmuebleIconSpecs({ bedrooms: '   ' })).toEqual([])
  })
})

test.describe('inmueble-hero · approximate-zone map (S5.2)', () => {
  test('builds a Google Maps search of the zone string (no exact address)', () => {
    expect(zoneMapUrl('Roma Norte, CDMX')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Roma%20Norte%2C%20CDMX',
    )
  })

  test('no location → no map link', () => {
    expect(zoneMapUrl(null)).toBeNull()
    expect(zoneMapUrl('   ')).toBeNull()
    expect(zoneMapUrl(undefined)).toBeNull()
  })
})

test.describe('inmueble-hero · visit decision (S5.2)', () => {
  test('a booking_url makes the primary "Agendar visita" → the calendar', () => {
    const m = inmuebleHeroModel({ bookingUrl: 'https://cal.com/seller/visita' })
    expect(m.hasSchedule).toBe(true)
    expect(m.primaryLabel).toBe('Agendar visita')
  })

  test('no booking_url degrades to "Solicitar visita"', () => {
    const m = inmuebleHeroModel({ bookingUrl: null })
    expect(m.hasSchedule).toBe(false)
    expect(m.primaryLabel).toBe('Solicitar visita')
  })
})
