import { expect, test } from '@playwright/test'
import { getSetupSteps, personalizeSetupSteps, type ShopRow } from '../lib/setup-guide'
import type { TenantIntake } from '../lib/onboarding-personalization'

/**
 * Pure-logic spec (api project, no DOM/network) for onboarding-three-doors
 * Sprint 2 · Story 2.3 — S6 personalization over the P0·B setup guide.
 * Mirrors `personalizeDoors`' own test shape in `onboarding-three-doors.spec.ts`.
 */

const emptyShop: ShopRow = {
  name: '',
  description: null,
  metadata: null,
  mp_enabled: null,
  custom_domain: null,
  ucp_webhook_url: null,
}

function baseSteps() {
  return getSetupSteps({ shop: emptyShop, productCount: 0, shareDone: false })
}

test.describe('onboarding-guide-personalization · personalizeSetupSteps', () => {
  test('no intake → the exact same steps, unchanged (fail-safe / ghost path)', () => {
    const steps = baseSteps()
    expect(personalizeSetupSteps(steps, null)).toEqual(steps)
  })

  test('empty sellsWhere → same default order as no intake', () => {
    const steps = baseSteps()
    const intake: TenantIntake = { sells: [], sellsWhere: [] }
    expect(personalizeSetupSteps(steps, intake).map((s) => s.id)).toEqual(steps.map((s) => s.id))
  })

  test('"sin_vender" only → still the default (not an existing channel)', () => {
    const steps = baseSteps()
    const intake: TenantIntake = { sells: [], sellsWhere: ['sin_vender'] }
    expect(personalizeSetupSteps(steps, intake).map((s) => s.id)).toEqual(steps.map((s) => s.id))
  })

  test('mercado_libre → catalogo promoted to the front', () => {
    const steps = baseSteps()
    const intake: TenantIntake = { sells: [], sellsWhere: ['mercado_libre'] }
    const result = personalizeSetupSteps(steps, intake)
    expect(result[0].id).toBe('catalogo')
    expect(result.map((s) => s.id).sort()).toEqual(steps.map((s) => s.id).sort())
  })

  test('an existing non-ML channel (whatsapp) also promotes catalogo', () => {
    const steps = baseSteps()
    const intake: TenantIntake = { sells: [], sellsWhere: ['whatsapp'] }
    expect(personalizeSetupSteps(steps, intake)[0].id).toBe('catalogo')
  })

  test('reordering never touches done/open flags — only step order', () => {
    const steps = baseSteps()
    const intake: TenantIntake = { sells: [], sellsWhere: ['tienda_fisica'] }
    const result = personalizeSetupSteps(steps, intake)
    for (const step of steps) {
      const moved = result.find((s) => s.id === step.id)
      expect(moved?.done).toBe(step.done)
      expect(moved?.open).toBe(step.open)
    }
  })
})
