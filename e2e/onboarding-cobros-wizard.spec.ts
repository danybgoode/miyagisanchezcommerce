import { test, expect } from '@playwright/test'
import { resolveCobrosWizardStep } from '../lib/cobros-wizard'
import { buildWhatsAppShareLink } from '../lib/share-link'

/**
 * Onboarding three-doors — Sprint 3 pure-logic specs (Stories 3.1-3.2).
 * No browser, no server — same discipline as `e2e/onboarding-three-doors.spec.ts`.
 * The wizard's rendered UI (step dots, R6-before info box, resume banner) is
 * built from this resolver, so asserting its branches here covers the "does
 * the right step/banner show" acceptance without needing a browser — the
 * real MP OAuth round-trip itself is owed to Daniel (money/auth).
 */

test.describe('cobros-wizard · resolveCobrosWizardStep', () => {
  test('landing with mp=connected → step 2, connected banner', () => {
    const result = resolveCobrosWizardStep({ mp: 'connected', mpConnected: false })
    expect(result).toEqual({ step: 2, banner: 'connected' })
  })

  test('landing with mp=error → step 1, error banner, reason carried through', () => {
    const result = resolveCobrosWizardStep({ mp: 'error', reason: 'invalid_grant', mpConnected: false })
    expect(result.step).toBe(1)
    expect(result.banner).toBe('error')
    expect(result.errorReason).toBe('invalid_grant')
  })

  test('mp=error with no reason → error banner, no reason string', () => {
    const result = resolveCobrosWizardStep({ mp: 'error', mpConnected: false })
    expect(result.banner).toBe('error')
    expect(result.errorReason).toBeUndefined()
  })

  test('no round-trip param, already connected (returning seller) → step 3, no banner', () => {
    const result = resolveCobrosWizardStep({ mpConnected: true })
    expect(result).toEqual({ step: 3, banner: null })
  })

  test('no round-trip param, not connected (fresh seller) → step 1, no banner', () => {
    const result = resolveCobrosWizardStep({ mpConnected: false })
    expect(result).toEqual({ step: 1, banner: null })
  })
})

test.describe('share-link · buildWhatsAppShareLink', () => {
  test('builds a wa.me link with the title + url URL-encoded', () => {
    const url = buildWhatsAppShareLink('Mi tienda', 'https://miyagisanchez.com/s/mi-tienda')
    expect(url).toBe('https://wa.me/?text=Mi%20tienda%3A%20https%3A%2F%2Fmiyagisanchez.com%2Fs%2Fmi-tienda')
  })

  test('round-trips through decodeURIComponent back to "title: url"', () => {
    const title = 'Panadería La Espiga'
    const shareUrl = 'https://miyagisanchez.com/s/panaderia-la-espiga'
    const url = buildWhatsAppShareLink(title, shareUrl)
    const encoded = url.split('text=')[1]
    expect(decodeURIComponent(encoded)).toBe(`${title}: ${shareUrl}`)
  })
})
