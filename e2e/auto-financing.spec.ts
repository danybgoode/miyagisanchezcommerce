import { test, expect } from '@playwright/test'
import { financingDisplay, warrantyDisplay, inspectionDisplay, FINANCING_DISCLAIMER } from '../lib/auto-financing'

/**
 * cars-vertical S2.1/S2.2 — pure financing/warranty/inspection projections.
 * No network / no `next/*` → runs in the `api` gate. AutoHero.tsx, the /l
 * card chip, and the UCP catalog all render these models, so the $/mes math,
 * the mandatory disclaimer, and the render-gating (absent field → null →
 * nothing renders) are spec-provable here rather than in JSX.
 */

test.describe('auto-financing · financingDisplay (S2.1)', () => {
  test('price + enganche % + months derives the monthly amount and always carries the disclaimer', () => {
    // $300,000 price, 20% enganche → $240,000 financed / 48 meses = $5,000/mes
    const d = financingDisplay({ priceCents: 300_000_00, downPaymentPct: 20, months: 48 })
    expect(d).not.toBeNull()
    expect(d!.monthlyLabel).toContain('/mes')
    expect(d!.monthlyLabel).toContain('5,000')
    expect(d!.monthlyCents).toBe(500_000) // $5,000.00 in cents — the raw value the UCP catalog reads
    expect(d!.disclaimer).toBe(FINANCING_DISCLAIMER)
  })

  test('string-typed raw attrs values (as stored in metadata.attrs) work the same as numbers', () => {
    const d = financingDisplay({ priceCents: 300_000_00, downPaymentPct: '20', months: '48' })
    expect(d).not.toBeNull()
    expect(d!.monthlyLabel).toContain('5,000')
  })

  test('no price → null (renders nothing)', () => {
    expect(financingDisplay({ priceCents: null, downPaymentPct: 20, months: 48 })).toBeNull()
    expect(financingDisplay({ priceCents: undefined, downPaymentPct: 20, months: 48 })).toBeNull()
    expect(financingDisplay({ priceCents: 0, downPaymentPct: 20, months: 48 })).toBeNull()
  })

  test('down payment missing, non-numeric, or out of [0,100) → null', () => {
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: undefined, months: 48 })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 'veinte', months: 48 })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: -5, months: 48 })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 100, months: 48 })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 150, months: 48 })).toBeNull()
  })

  test('months missing, non-numeric, or non-positive → null', () => {
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 20, months: undefined })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 20, months: 0 })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 20, months: -12 })).toBeNull()
    expect(financingDisplay({ priceCents: 300_000_00, downPaymentPct: 20, months: 'muchos' })).toBeNull()
  })

  test('0% enganche is a valid input (finances the full price)', () => {
    const d = financingDisplay({ priceCents: 120_000_00, downPaymentPct: 0, months: 12 })
    expect(d).not.toBeNull()
    expect(d!.monthlyLabel).toContain('10,000')
  })

  test('a fractional months value is rounded to a whole month, not silently divided against', () => {
    const rounded = financingDisplay({ priceCents: 120_000_00, downPaymentPct: 0, months: 11.6 }) // rounds to 12
    const exact = financingDisplay({ priceCents: 120_000_00, downPaymentPct: 0, months: 12 })
    expect(rounded!.monthlyCents).toBe(exact!.monthlyCents)
  })

  test('a fractional months value that rounds to 0 → null (not a division by a sub-1 term)', () => {
    expect(financingDisplay({ priceCents: 120_000_00, downPaymentPct: 0, months: 0.4 })).toBeNull()
  })
})

test.describe('auto-financing · warrantyDisplay (S2.1)', () => {
  test('months present → chip states the term', () => {
    const w = warrantyDisplay({ text: null, months: 6 })
    expect(w).not.toBeNull()
    expect(w!.chipLabel).toBe('Garantía: 6 meses')
    expect(w!.text).toBeNull()
    expect(w!.months).toBe(6)
  })

  test('text only (no months) → generic chip, text carried for detail', () => {
    const w = warrantyDisplay({ text: '6 meses motor y transmisión', months: null })
    expect(w).not.toBeNull()
    expect(w!.chipLabel).toBe('Garantía')
    expect(w!.text).toBe('6 meses motor y transmisión')
    expect(w!.months).toBeNull()
  })

  test('both present → months drive the chip, text still carried', () => {
    const w = warrantyDisplay({ text: 'Motor y transmisión', months: 12 })
    expect(w!.chipLabel).toBe('Garantía: 12 meses')
    expect(w!.text).toBe('Motor y transmisión')
    expect(w!.months).toBe(12)
  })

  test('neither present → null (renders nothing)', () => {
    expect(warrantyDisplay({ text: null, months: null })).toBeNull()
    expect(warrantyDisplay({ text: '   ', months: undefined })).toBeNull()
    expect(warrantyDisplay({ text: undefined, months: 0 })).toBeNull()
  })
})

test.describe('auto-financing · inspectionDisplay (S2.1)', () => {
  test('a valid https URL passes through', () => {
    const i = inspectionDisplay({ url: 'https://cdn.example.com/reports/car123.pdf' })
    expect(i).not.toBeNull()
    expect(i!.url).toBe('https://cdn.example.com/reports/car123.pdf')
  })

  test('a valid http URL also passes through', () => {
    expect(inspectionDisplay({ url: 'http://example.com/r.pdf' })).toEqual({ url: 'http://example.com/r.pdf' })
  })

  test('empty, whitespace, or non-http(s) values → null (never a dead link)', () => {
    expect(inspectionDisplay({ url: '' })).toBeNull()
    expect(inspectionDisplay({ url: '   ' })).toBeNull()
    expect(inspectionDisplay({ url: 'not-a-url' })).toBeNull()
    expect(inspectionDisplay({ url: 'ftp://example.com/r.pdf' })).toBeNull()
    expect(inspectionDisplay({ url: undefined })).toBeNull()
    expect(inspectionDisplay({ url: 123 })).toBeNull()
  })
})
