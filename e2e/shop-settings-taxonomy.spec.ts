import { test, expect } from '@playwright/test'
import {
  orderedSections,
  sectionDef,
  sectionTitle,
  isValidSection,
  isManual,
  sectionIdsFor,
  MANUAL_KEYS,
} from '../lib/shop-settings/taxonomy'
import {
  parseLocation,
  detectSchedulingService,
  generateHex32,
  PRESETS,
} from '../lib/shop-settings/helpers'

/**
 * Shop Settings refactor · Sprint 1.1 — the canonical taxonomy + pure helpers.
 * Before this, slug→section data lived in three places that could drift (the
 * index cards, the [section] page titles, and the monolith's SLUG_TO_SECTION_IDS).
 * They now all derive from ONE map; this spec is the guard that the map stays
 * complete + the moved helpers keep their behavior. Pure; no network/auth.
 */

// The 11 slugs the settings index links to and the [section] route accepts.
const SLUGS = [
  'perfil', 'pagos', 'envios', 'negociacion', 'citas', 'notificaciones',
  'diseno', 'agentes', 'canal', 'pedidos', 'politicas',
]

test.describe('shop-settings-taxonomy · canonical map', () => {
  test('exactly the 11 sections, in index order', () => {
    expect(orderedSections().map((s) => s.slug)).toEqual(SLUGS)
  })

  test('every slug resolves to a def with a title + ≥1 internal section id', () => {
    for (const slug of SLUGS) {
      const def = sectionDef(slug)
      expect(def, slug).toBeTruthy()
      expect(sectionTitle(slug), slug).toBeTruthy()
      expect(isValidSection(slug), slug).toBe(true)
      expect(sectionIdsFor(slug).length, slug).toBeGreaterThan(0)
    }
  })

  test('rejects unknown slugs', () => {
    expect(isValidSection('does-not-exist')).toBe(false)
    expect(sectionDef('does-not-exist')).toBeUndefined()
    expect(sectionTitle('does-not-exist')).toBeUndefined()
  })

  test('manual flags match the four OAuth/money/domain sections', () => {
    expect([...MANUAL_KEYS].sort()).toEqual(['agentes', 'canal', 'citas', 'pagos'])
    expect(isManual('pagos')).toBe(true)
    expect(isManual('perfil')).toBe(false)
  })

  test('preserves the non-identity slug→section-id fan-out (was SLUG_TO_SECTION_IDS)', () => {
    expect(sectionIdsFor('pagos')).toEqual(['proteccion', 'stripe', 'mercadopago', 'spei'])
    expect(sectionIdsFor('envios')).toEqual(['comunicacion', 'envios'])
    expect(sectionIdsFor('diseno')).toEqual(['apariencia', 'tipo'])
    expect(sectionIdsFor('canal')).toEqual(['canal', 'apoyo', 'widget'])
    expect(sectionIdsFor('negociacion')).toEqual(['ofertas'])
  })

  test('falls back to [slug] for the identity sub-section aliases', () => {
    // apoyo/widget/bundles were identity mappings in SLUG_TO_SECTION_IDS — the
    // `?? [slug]` fallback reproduces them byte-for-byte.
    expect(sectionIdsFor('apoyo')).toEqual(['apoyo'])
    expect(sectionIdsFor('widget')).toEqual(['widget'])
    expect(sectionIdsFor('bundles')).toEqual(['bundles'])
  })

  test('politicas keeps its distinct card label vs page heading', () => {
    const def = sectionDef('politicas')!
    expect(def.cardTitle).toBe('Devoluciones')
    expect(def.title).toBe('Política de devoluciones')
  })
})

test.describe('shop-settings-taxonomy · pure helpers', () => {
  test('parseLocation splits "City, State"', () => {
    expect(parseLocation('Mérida, Yucatán')).toEqual({ city: 'Mérida', state: 'Yucatán' })
    expect(parseLocation('Ciudad de México')).toEqual({ city: '', state: 'Ciudad de México' })
    expect(parseLocation(null)).toEqual({ city: '', state: '' })
  })

  test('detectSchedulingService names known hosts, else a generic label', () => {
    expect(detectSchedulingService('https://cal.com/me/visita')).toBe('Cal.com')
    expect(detectSchedulingService('https://calendly.com/me')).toBe('Calendly')
    expect(detectSchedulingService('https://example.com/book')).toBe('Cita en línea')
  })

  test('generateHex32 is 64 lowercase hex chars', () => {
    const hex = generateHex32()
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    expect(generateHex32()).not.toBe(hex) // random
  })

  test('PRESETS carries the six store types', () => {
    expect(PRESETS.map((p) => p.key)).toEqual([
      'basico', 'protegido', 'alto_valor', 'vehiculos', 'inmuebles', 'digital',
    ])
    for (const p of PRESETS) {
      expect(p.settings.checkout?.escrow_mode, p.key).toBeTruthy()
    }
  })
})
