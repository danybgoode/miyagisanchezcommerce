import { test, expect } from '@playwright/test'
import { formatRentalBookingLines, rentalBookingBadge, type RentalBookingLike } from '../lib/rental-booking'

/**
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 2, Story 2.3.
 *
 * `formatRentalBookingLines` is the ONE formatting seam all 5 rendering surfaces
 * (buyer + seller order pages, both confirmation emails, in-chat ledger) import
 * from — proven here so every surface renders the identical dates/deposit text.
 */

const BOOKING: RentalBookingLike = {
  check_in: '2026-08-01',
  check_out: '2026-08-04',
  nights: 3,
  units: 3,
  rate_period: 'dia',
  rate_cents: 120_000,
  rent_cents: 360_000,
  deposit_cents: 200_000,
  total_cents: 560_000,
}

test.describe('rental-booking · formatRentalBookingLines', () => {
  test('formats dates, breakdown, deposit, and total using the shared rental-pricing helpers', () => {
    const lines = formatRentalBookingLines(BOOKING, 'MXN')
    expect(lines.dates).toBe('2026-08-01 → 2026-08-04')
    expect(lines.breakdown).toBe('$1,200 × 3 noches = $3,600')
    expect(lines.deposit).toBe('Depósito reembolsable: $2,000')
    expect(lines.total).toBe('$5,600')
  })

  test('a zero-deposit booking omits the deposit line entirely (null, not empty string)', () => {
    const lines = formatRentalBookingLines({ ...BOOKING, deposit_cents: 0, total_cents: 360_000 }, 'MXN')
    expect(lines.deposit).toBeNull()
    expect(lines.total).toBe('$3,600')
  })

  test('an unknown/garbage rate_period normalises to día rather than throwing', () => {
    const lines = formatRentalBookingLines({ ...BOOKING, rate_period: 'garbage' }, 'MXN')
    expect(lines.breakdown).toContain('noches')
  })
})

test.describe('rental-booking · rentalBookingBadge', () => {
  test('es-MX badge for each state', () => {
    expect(rentalBookingBadge('reservado')).toBe('📅 Reservado')
    expect(rentalBookingBadge('none')).toBe('Sin reservar')
  })
})
