import { test, expect } from '@playwright/test'
import { matchesCoverage, COVERAGE_NOTICE_TEXT } from '../lib/promoter-coverage'

/**
 * Promoter Funnel v2 · Sprint 5 (US-5.3) — the zine coverage honesty matcher
 * (api project: pure logic, no network, no Supabase). `coverage_zones` is a
 * free-form neighborhood-string array with no standardized geography, so this
 * is a v1 substring matcher — fixtures below cover the accepted scope, not a
 * geocoding project.
 */

test.describe('promoter coverage · matchesCoverage', () => {
  test('exact municipio match', () => {
    const result = matchesCoverage({ municipio: 'Roma', estado: 'Ciudad de México' }, ['Roma', 'Condesa'])
    expect(result.inCoverage).toBe(true)
    expect(result.matchedZone).toBe('Roma')
  })

  test('substring match — shop municipio contains the zone name', () => {
    const result = matchesCoverage({ municipio: 'Colonia Roma Norte' }, ['Roma'])
    expect(result.inCoverage).toBe(true)
  })

  test('substring match — the other direction (zone name contains the shop municipio)', () => {
    const result = matchesCoverage({ municipio: 'Roma' }, ['Colonia Roma Norte'])
    expect(result.inCoverage).toBe(true)
  })

  test('colonia list match, independent of municipio', () => {
    const result = matchesCoverage({ municipio: 'Cuauhtémoc', colonias: ['Doctores', 'Condesa'] }, ['Condesa'])
    expect(result.inCoverage).toBe(true)
    expect(result.matchedZone).toBe('Condesa')
  })

  test('accent- and case-insensitive', () => {
    const result = matchesCoverage({ municipio: 'CUAUHTÉMOC' }, ['cuauhtemoc'])
    expect(result.inCoverage).toBe(true)
  })

  test('estado alone never matches — too coarse, would defeat the honesty check', () => {
    const result = matchesCoverage({ estado: 'Ciudad de México', municipio: 'Iztapalapa' }, ['Ciudad de México'])
    expect(result.inCoverage).toBe(false)
  })

  test('empty coverage_zones ⇒ unknown ⇒ not in coverage', () => {
    const result = matchesCoverage({ municipio: 'Roma' }, [])
    expect(result.inCoverage).toBe(false)
    expect(result.matchedZone).toBeNull()
  })

  test('missing shop location ⇒ unknown ⇒ not in coverage', () => {
    const result = matchesCoverage({}, ['Roma', 'Condesa'])
    expect(result.inCoverage).toBe(false)
  })

  test('true no-overlap case', () => {
    const result = matchesCoverage({ municipio: 'Guadalajara', colonias: ['Chapalita'] }, ['Roma', 'Condesa'])
    expect(result.inCoverage).toBe(false)
    expect(result.matchedZone).toBeNull()
  })

  test('COVERAGE_NOTICE_TEXT is a non-empty es-MX string the UI can render verbatim', () => {
    expect(COVERAGE_NOTICE_TEXT.length).toBeGreaterThan(10)
    expect(COVERAGE_NOTICE_TEXT).toMatch(/cobertura|cubre|branding/i)
  })
})
