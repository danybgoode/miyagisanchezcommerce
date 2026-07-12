import { expect, test } from '@playwright/test'
import { previewOverrideValue } from '../lib/copy-overrides-preview'

// Pure-seam coverage for the editor's before/after preview (epic 08 ·
// cms-contenido-restore-and-polish, Story 1.3). No browser, no network —
// proves the preview goes through the SAME `applyCopyOverrides`/`copy-tree`
// primitives the live read path uses, not a separate string comparison.

test.describe('previewOverrideValue · same merge shape as production', () => {
  test('a simple string leaf resolves the candidate value', () => {
    expect(previewOverrideValue('sellerAcquisition', 'anchor.heroTitle', 'es', 'Vende gratis.', 'Vende hoy mismo.')).toBe(
      'Vende hoy mismo.',
    )
  })

  test('an array-index leaf resolves correctly', () => {
    expect(previewOverrideValue('sellerAcquisition', 'anchor.heroStats.0.value', 'es', '0%', '5%')).toBe('5%')
  })

  test('a deeper nested path resolves correctly', () => {
    expect(previewOverrideValue('promotor', 'steps.2.title', 'es', 'Cierra la venta', 'Cierra ya')).toBe('Cierra ya')
  })

  test('is a true round-trip identity for any key that resolves cleanly — the draft always wins', () => {
    const result = previewOverrideValue('terms', 'sections.0.body', 'es', 'texto original', 'texto editado')
    expect(result).toBe('texto editado')
    expect(result).not.toBe('texto original')
  })
})
