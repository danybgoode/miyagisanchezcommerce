import { test, expect } from '@playwright/test'
import { isOnboardingPath } from '../lib/onboarding-path'
import { personalizeDoors, type TenantIntake } from '../lib/onboarding-personalization'
import { validateSetup } from '../lib/setup-spec'
import { parseCatalogFile } from '../lib/catalog-import'

/**
 * Onboarding three-doors — pure-logic specs (Sprint 1 · Stories 1.1-1.3).
 * No browser, no server — same discipline as `e2e/seller-mode.spec.ts`.
 */

test.describe('onboarding-three-doors · isOnboardingPath', () => {
  test('matches only the three Sprint 1 routes', () => {
    expect(isOnboardingPath('/sell/bienvenida')).toBe(true)
    expect(isOnboardingPath('/sell/puertas')).toBe(true)
    expect(isOnboardingPath('/sell/agente')).toBe(true)
  })

  test('does not match sibling /sell routes or buyer routes', () => {
    expect(isOnboardingPath('/sell')).toBe(false)
    expect(isOnboardingPath('/sell/setup')).toBe(false)
    expect(isOnboardingPath('/sell/edit/abc')).toBe(false)
    expect(isOnboardingPath('/sell/print/abc')).toBe(false)
    expect(isOnboardingPath('/shop/manage')).toBe(false)
    expect(isOnboardingPath('/')).toBe(false)
    expect(isOnboardingPath('')).toBe(false)
  })
})

test.describe('onboarding-three-doors · personalizeDoors', () => {
  test('no intake → the default order + generic subtitle', () => {
    const { order, subtitle } = personalizeDoors(null)
    expect(order).toEqual(['agent', 'wizard', 'import'])
    expect(subtitle).toContain('cambiar de camino')
  })

  test('empty sellsWhere → same default as no intake', () => {
    const intake: TenantIntake = { sells: [], sellsWhere: [] }
    expect(personalizeDoors(intake).order).toEqual(['agent', 'wizard', 'import'])
  })

  test('"sin_vender" only → still the default (not an existing channel)', () => {
    const intake: TenantIntake = { sells: [], sellsWhere: ['sin_vender'] }
    const { order, subtitle } = personalizeDoors(intake)
    expect(order).toEqual(['agent', 'wizard', 'import'])
    expect(subtitle).toContain('cambiar de camino')
  })

  test('mercado_libre → import ranks above wizard + the ML-specific subtitle', () => {
    const intake: TenantIntake = { sells: [], sellsWhere: ['mercado_libre'] }
    const { order, subtitle } = personalizeDoors(intake)
    expect(order).toEqual(['agent', 'import', 'wizard'])
    expect(subtitle).toContain('Mercado Libre')
  })

  test('an existing non-ML channel → import ranks above wizard, generic existing-channel subtitle', () => {
    const intake: TenantIntake = { sells: [], sellsWhere: ['instagram_facebook'] }
    const { order, subtitle } = personalizeDoors(intake)
    expect(order).toEqual(['agent', 'import', 'wizard'])
    expect(subtitle).not.toContain('Mercado Libre')
  })

  test('door 1 (agent) is always first, regardless of intake', () => {
    expect(personalizeDoors(null).order[0]).toBe('agent')
    expect(personalizeDoors({ sells: [], sellsWhere: ['whatsapp'] }).order[0]).toBe('agent')
    expect(personalizeDoors({ sells: [], sellsWhere: ['tienda_fisica'] }).order[0]).toBe('agent')
  })
})

test.describe('onboarding-three-doors · S3 CSV/JSON → MiyagiSetupFile handoff contract', () => {
  test('a catalog-only CSV wraps into a MiyagiSetupFile that validateSetup accepts', () => {
    const csv = 'title,price,category\nMaceta de barro,350,hogar\n'
    const parsed = parseCatalogFile(csv, 'productos.csv')
    expect(parsed.fileErrors).toEqual([])
    expect(parsed.staged.length).toBe(1)

    const setupFile = {
      miyagi_setup_version: '1',
      catalog: parsed.staged.map((s) => s.row),
    }
    const v = validateSetup(setupFile)
    expect(v.ok).toBe(true)
    expect(v.counts.catalog_rows).toBe(1)
  })

  test('a bare JSON array of products also wraps cleanly', () => {
    const json = JSON.stringify([{ title: 'Bonsai ficus', price: 899, category: 'hogar' }])
    const parsed = parseCatalogFile(json, 'productos.json')
    expect(parsed.fileErrors).toEqual([])

    const setupFile = { miyagi_setup_version: '1', catalog: parsed.staged.map((s) => s.row) }
    expect(validateSetup(setupFile).ok).toBe(true)
  })

  test('an empty file surfaces a file-level error, not a silent empty catalog', () => {
    const parsed = parseCatalogFile('', 'vacio.csv')
    expect(parsed.fileErrors.length).toBeGreaterThan(0)
    expect(parsed.staged).toEqual([])
  })
})
