/**
 * lib/service-hero.ts
 *
 * PDP redesign (epic 01) — Sprint 4, S4.1 (services).
 *
 * Pure, next-free seam deciding the service PDP's hero action. A service should
 * lead with scheduling, not a boxed-product buy bar: when the seller has a Cal.com
 * `booking_url` (or a scheduling link) the primary action is "Agendar cita"
 * (links out to the live calendar); otherwise it degrades to "Solicitar cita"
 * (start a conversation). No JSX / no network → unit-testable in the `api` gate
 * (`e2e/service-hero.spec.ts`). The component (`app/l/[id]/ServiceHero.tsx`)
 * renders the model; this module owns only the decision so it can't drift.
 */

export interface ServiceHeroInput {
  /** Cal.com booking_url or the first scheduling link, already resolved on the page. */
  bookingUrl: string | null
  /** Cal.com event-type title or the scheduling link label, if any. */
  bookingText: string | null
}

export interface ServiceHeroModel {
  /** The seller exposes a live calendar → the primary CTA links out to it. */
  hasSchedule: boolean
  /** es-MX primary-action label. */
  primaryLabel: string
  /** Heading for the schedule card. */
  scheduleHeading: string
  /** Sub-label under the heading (event title / link label / a neutral fallback). */
  scheduleNote: string
}

export function serviceHeroModel(input: ServiceHeroInput): ServiceHeroModel {
  const hasSchedule = !!(input.bookingUrl && input.bookingUrl.trim())
  const note = input.bookingText?.trim()
  return {
    hasSchedule,
    primaryLabel: hasSchedule ? 'Agendar cita' : 'Solicitar cita',
    scheduleHeading: hasSchedule ? 'Próximas fechas' : 'Agenda con el vendedor',
    scheduleNote: hasSchedule
      ? note || 'Elige un horario disponible en el calendario'
      : 'Coordina la fecha y hora directamente con el vendedor',
  }
}
