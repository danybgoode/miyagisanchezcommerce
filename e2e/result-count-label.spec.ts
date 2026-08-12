import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { resultCountLabel } from '../lib/listing-query'

/**
 * The mobile filter's apply button was hardcoded es-MX, and leaked one Spanish
 * string onto the US buyer path: `/us/l` rendered an otherwise fully English page
 * whose filter button read "Sin resultados".
 *
 * Language is now a parameter, exactly like every other label in
 * `market-vocabulary.ts`, defaulting to 'es' so MX is unchanged.
 */

const ROOT = path.join(import.meta.dirname, '..')

test.describe('resultCountLabel · language is a parameter, not an assumption', () => {
  test('English for the US buyer path', () => {
    expect(resultCountLabel(null, 'en')).toBe('See results')
    expect(resultCountLabel(0, 'en')).toBe('No results')
    expect(resultCountLabel(1, 'en')).toBe('See 1 result')
    expect(resultCountLabel(7, 'en')).toBe('See 7 results')
  })

  test('Spanish is unchanged, including the default with no language passed', () => {
    expect(resultCountLabel(null)).toBe('Ver resultados')
    expect(resultCountLabel(0)).toBe('Sin resultados')
    expect(resultCountLabel(1)).toBe('Ver 1 resultado')
    expect(resultCountLabel(7)).toBe('Ver 7 resultados')
    expect(resultCountLabel(7, 'es')).toBe('Ver 7 resultados')
  })

  test('singular and plural are distinguished in both languages', () => {
    expect(resultCountLabel(1, 'en')).not.toBe(resultCountLabel(2, 'en'))
    expect(resultCountLabel(1, 'es')).not.toBe(resultCountLabel(2, 'es'))
  })

  test('the caller passes the market language rather than relying on the default', () => {
    const bar = fs.readFileSync(path.join(ROOT, 'app/(shell)/l/SearchBar.tsx'), 'utf8')
    expect(bar).toContain('resultCountLabel(count, presentation.language)')
  })

  // A US page must contain no Spanish from this helper at all.
  test('no English-path output contains a Spanish token', () => {
    for (const count of [null, 0, 1, 5] as const) {
      const label = resultCountLabel(count, 'en')
      expect(label).not.toMatch(/resultado|Ver |Sin /)
    }
  })
})
