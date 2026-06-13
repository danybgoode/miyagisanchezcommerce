import { test, expect } from '@playwright/test'
import { serviceHeroModel } from '../lib/service-hero'

/**
 * PDP redesign (epic 01) — Sprint 4, S4.1 (services).
 *
 * Pure-logic gate for the service hero's scheduling decision. No network / no
 * `next/*` — runs in the `api` gate. The PDP renders the model this returns, so
 * "lead with Agendar when there's a calendar, else Solicitar" is spec-provable.
 */

test.describe('service-hero · schedule-led decision (S4.1)', () => {
  test('a booking_url makes the primary action "Agendar cita" → the calendar', () => {
    const m = serviceHeroModel({ bookingUrl: 'https://cal.com/seller/cita', bookingText: 'Consulta inicial' })
    expect(m.hasSchedule).toBe(true)
    expect(m.primaryLabel).toBe('Agendar cita')
    expect(m.scheduleHeading).toBe('Próximas fechas')
    expect(m.scheduleNote).toBe('Consulta inicial')
  })

  test('a booking_url with no event title falls back to a neutral note', () => {
    const m = serviceHeroModel({ bookingUrl: 'https://cal.com/seller/cita', bookingText: null })
    expect(m.hasSchedule).toBe(true)
    expect(m.scheduleNote).toBe('Elige un horario disponible en el calendario')
  })

  test('no booking_url degrades to "Solicitar cita" (start a conversation)', () => {
    const m = serviceHeroModel({ bookingUrl: null, bookingText: null })
    expect(m.hasSchedule).toBe(false)
    expect(m.primaryLabel).toBe('Solicitar cita')
    expect(m.scheduleHeading).toBe('Agenda con el vendedor')
    expect(m.scheduleNote).toBe('Coordina la fecha y hora directamente con el vendedor')
  })

  test('an empty / whitespace booking_url is treated as no schedule', () => {
    expect(serviceHeroModel({ bookingUrl: '', bookingText: null }).hasSchedule).toBe(false)
    expect(serviceHeroModel({ bookingUrl: '   ', bookingText: null }).hasSchedule).toBe(false)
  })
})
