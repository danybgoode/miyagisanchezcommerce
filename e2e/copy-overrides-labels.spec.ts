import { expect, test } from '@playwright/test'
import { humanizeKeyPath } from '../lib/copy-overrides-labels'

// Pure-seam coverage for the derived field labels (epic 08 ·
// cms-contenido-restore-and-polish, Story 3.1 — grooming dropped a
// hand-curated 1,121-key label map in favor of deriving one from the key
// path; the original es-MX value renders alongside for context).

test.describe('humanizeKeyPath', () => {
  test('drops the leading section segment and title-cases the rest', () => {
    expect(humanizeKeyPath('autos.heroTitle')).toBe('Hero Title')
    expect(humanizeKeyPath('anchor.heroTitle')).toBe('Hero Title')
  })

  test('a single-segment key keeps its only segment', () => {
    expect(humanizeKeyPath('title')).toBe('Title')
  })

  test('splits camelCase, digit, and separator boundaries into words', () => {
    expect(humanizeKeyPath('migracion.stepOneTitle')).toBe('Step One Title')
    expect(humanizeKeyPath('section.step1Label')).toBe('Step 1 Label')
    expect(humanizeKeyPath('section.snake_case_key')).toBe('Snake Case Key')
  })

  test('a multi-segment remainder after dropping the section joins all its words', () => {
    expect(humanizeKeyPath('migracion.steps.stepOne.title')).toBe('Steps Step One Title')
  })

  test('an all-caps acronym boundary does not split every letter', () => {
    expect(humanizeKeyPath('section.qrCodeURL')).toBe('Qr Code Url')
  })
})
