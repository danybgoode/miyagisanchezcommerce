import { test, expect } from '@playwright/test'
import { autoHeroModel, repuveDisplay } from '../lib/auto-hero'

/**
 * PDP redesign (epic 01) — Sprint 5, S5.1 (autos).
 *
 * Pure-logic gate for the autos hero. No network / no `next/*` — runs in the
 * `api` gate. The PDP renders the models these return, so "lead with REPUVE +
 * primary Agendar prueba" is spec-provable.
 */

test.describe('auto-hero · test-drive decision (S5.1)', () => {
  test('a booking_url makes the primary "Agendar prueba de manejo" → the calendar', () => {
    const m = autoHeroModel({ bookingUrl: 'https://cal.com/seller/prueba' })
    expect(m.hasSchedule).toBe(true)
    expect(m.primaryLabel).toBe('Agendar prueba de manejo')
  })

  test('no booking_url degrades to "Solicitar prueba de manejo" (start a conversation)', () => {
    const m = autoHeroModel({ bookingUrl: null })
    expect(m.hasSchedule).toBe(false)
    expect(m.primaryLabel).toBe('Solicitar prueba de manejo')
  })

  test('an empty / whitespace booking_url is treated as no schedule', () => {
    expect(autoHeroModel({ bookingUrl: '' }).hasSchedule).toBe(false)
    expect(autoHeroModel({ bookingUrl: '   ' }).hasSchedule).toBe(false)
  })
})

test.describe('auto-hero · REPUVE display (S5.1)', () => {
  test('sin_reporte → the reassuring green clean state', () => {
    const r = repuveDisplay({ status: 'sin_reporte', folio: 'ABC123' })
    expect(r).not.toBeNull()
    expect(r!.clean).toBe(true)
    expect(r!.label).toBe('Sin reporte REPUVE')
    expect(r!.folioLabel).toBe('Folio: ABC123')
    expect(r!.icon).toBe('iconoir-check-circle')
  })

  test('con_reporte → the red reported state (with folio)', () => {
    const r = repuveDisplay({ status: 'con_reporte', folio: 'X-9' })
    expect(r!.clean).toBe(false)
    expect(r!.label).toBe('Con reporte REPUVE')
    expect(r!.folioLabel).toBe('Folio: X-9')
    expect(r!.icon).toBe('iconoir-warning-triangle')
  })

  test('no folio → no folio line', () => {
    expect(repuveDisplay({ status: 'sin_reporte' })!.folioLabel).toBeNull()
  })

  test('absent / empty status → no anchor', () => {
    expect(repuveDisplay(null)).toBeNull()
    expect(repuveDisplay(undefined)).toBeNull()
    expect(repuveDisplay({ status: '   ' })).toBeNull()
    expect(repuveDisplay({})).toBeNull()
  })
})
