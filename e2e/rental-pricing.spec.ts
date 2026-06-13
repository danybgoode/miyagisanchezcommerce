import { test, expect } from '@playwright/test'
import {
  nightsBetween,
  rentalUnits,
  computeRentalTotal,
  rentalUnitsLabel,
  ratePeriodLabel,
  toRatePeriod,
  formatRentalCents,
} from '../lib/rental-pricing'

/**
 * PDP redesign (epic 01) — Sprint 4, S4.2 (rentals).
 *
 * The displayed rental total MUST be exact, so the math is a pure seam proven
 * here (no network / no `next/*`; runs in the `api` gate). The client island
 * renders exactly what these functions return.
 */

test.describe('rental-pricing · nightsBetween', () => {
  test('whole nights between two YYYY-MM-DD dates', () => {
    expect(nightsBetween('2026-06-13', '2026-06-16')).toBe(3)
    expect(nightsBetween('2026-06-13', '2026-06-14')).toBe(1)
  })

  test('non-positive / invalid ranges yield 0', () => {
    expect(nightsBetween('2026-06-16', '2026-06-13')).toBe(0) // reversed
    expect(nightsBetween('2026-06-13', '2026-06-13')).toBe(0) // same day
    expect(nightsBetween('', '2026-06-16')).toBe(0)
    expect(nightsBetween('2026-06-13', null)).toBe(0)
    expect(nightsBetween('not-a-date', '2026-06-16')).toBe(0)
  })

  test('does not drift across a DST boundary (UTC math)', () => {
    // Mexico shifts around early April in some years; whole-night count stays exact.
    expect(nightsBetween('2026-04-04', '2026-04-07')).toBe(3)
  })
})

test.describe('rental-pricing · billed units (ceil per period)', () => {
  test('día bills one unit per night', () => {
    expect(rentalUnits(3, 'dia')).toBe(3)
    expect(rentalUnits(1, 'dia')).toBe(1)
  })

  test('semana / mes bill whole partial periods up', () => {
    expect(rentalUnits(7, 'semana')).toBe(1)
    expect(rentalUnits(8, 'semana')).toBe(2)
    expect(rentalUnits(30, 'mes')).toBe(1)
    expect(rentalUnits(31, 'mes')).toBe(2)
  })

  test('a non-positive night count is 0 units', () => {
    expect(rentalUnits(0, 'dia')).toBe(0)
    expect(rentalUnits(-2, 'semana')).toBe(0)
  })
})

test.describe('rental-pricing · computeRentalTotal (exact)', () => {
  test('acceptance: a 3-day range = 3 × daily + deposit', () => {
    // $1,200/día daily, $2,000 deposit, 3 nights.
    const p = computeRentalTotal({ rateCents: 120000, depositCents: 200000, nights: 3, period: 'dia' })
    expect(p.units).toBe(3)
    expect(p.rentCents).toBe(360000)          // 3 × 120000
    expect(p.depositCents).toBe(200000)
    expect(p.totalCents).toBe(560000)         // 360000 + 200000
    expect(formatRentalCents(p.totalCents)).toBe('$5,600')
  })

  test('zero deposit drops out of the total', () => {
    const p = computeRentalTotal({ rateCents: 50000, depositCents: 0, nights: 2, period: 'dia' })
    expect(p.totalCents).toBe(100000)
    expect(p.depositCents).toBe(0)
  })

  test('weekly rate over 10 nights bills 2 weeks', () => {
    const p = computeRentalTotal({ rateCents: 300000, depositCents: 0, nights: 10, period: 'semana' })
    expect(p.units).toBe(2)
    expect(p.totalCents).toBe(600000)
  })

  test('no range → rent 0, deposit still surfaced', () => {
    const p = computeRentalTotal({ rateCents: 120000, depositCents: 200000, nights: 0, period: 'dia' })
    expect(p.units).toBe(0)
    expect(p.rentCents).toBe(0)
    expect(p.totalCents).toBe(200000)
  })

  test('negative / NaN inputs are clamped, never produce a negative total', () => {
    const p = computeRentalTotal({ rateCents: -100, depositCents: Number.NaN, nights: 3, period: 'dia' })
    expect(p.rentCents).toBe(0)
    expect(p.depositCents).toBe(0)
    expect(p.totalCents).toBe(0)
  })
})

test.describe('rental-pricing · labels', () => {
  test('toRatePeriod normalises to a known period (default día)', () => {
    expect(toRatePeriod('semana')).toBe('semana')
    expect(toRatePeriod('mes')).toBe('mes')
    expect(toRatePeriod('dia')).toBe('dia')
    expect(toRatePeriod(undefined)).toBe('dia')
    expect(toRatePeriod('garbage')).toBe('dia')
  })

  test('es-MX unit + period labels', () => {
    expect(rentalUnitsLabel(1, 'dia')).toBe('1 noche')
    expect(rentalUnitsLabel(3, 'dia')).toBe('3 noches')
    expect(rentalUnitsLabel(2, 'semana')).toBe('2 semanas')
    expect(rentalUnitsLabel(1, 'mes')).toBe('1 mes')
    expect(ratePeriodLabel('dia')).toBe('día')
    expect(ratePeriodLabel('semana')).toBe('semana')
    expect(ratePeriodLabel('mes')).toBe('mes')
  })
})
