import { test, expect } from '@playwright/test'
import {
  derivePickupAppointmentState,
  pickupAppointmentFromOrder,
  canTransition,
  canSellerConfirm,
  canBuyerConfirm,
  canSellerReschedule,
  pickupAppointmentBadge,
  whoActsNextPickup,
  pickupAppointmentDetail,
  pickupWindowLabel,
  formatPickupAppointment,
  PICKUP_WINDOWS,
  type PickupAppointmentLike,
} from '../lib/pickup-appointment'

// Pure-logic spec — no auth, no network. Proves the two-sided propose-and-confirm pickup
// machine (lib/pickup-appointment.ts) that the buyer view, seller view, and the backend
// normalizer all read. Mirrors refund-state.spec.ts.

const buyerProposal: PickupAppointmentLike = {
  spot_id: 'spot_1', date: '2026-06-13', window: 'tarde',
  status: 'propuesta', proposed_by: 'buyer', proposed_at: '2026-06-09T10:00:00Z', confirmed_at: null,
}
const sellerCounter: PickupAppointmentLike = {
  ...buyerProposal, window: 'manana', status: 'propuesta', proposed_by: 'seller',
}
const confirmed: PickupAppointmentLike = {
  ...buyerProposal, status: 'confirmada', confirmed_at: '2026-06-09T11:00:00Z',
}

test.describe('pickup-appointment · derivation', () => {
  test('no record → none', () => {
    expect(derivePickupAppointmentState(null)).toBe('none')
    expect(derivePickupAppointmentState(undefined)).toBe('none')
    expect(derivePickupAppointmentState({})).toBe('none')
  })
  test('buyer proposed → propuesta', () => {
    expect(derivePickupAppointmentState(buyerProposal)).toBe('propuesta')
  })
  test('seller counter → propuesta', () => {
    expect(derivePickupAppointmentState(sellerCounter)).toBe('propuesta')
  })
  test('confirmed → confirmada', () => {
    expect(derivePickupAppointmentState(confirmed)).toBe('confirmada')
  })
  test('unknown status → none', () => {
    expect(derivePickupAppointmentState({ status: 'whatever' })).toBe('none')
  })
})

test.describe('pickup-appointment · fromOrder seam', () => {
  test('prefers the normalizer-emitted state', () => {
    expect(pickupAppointmentFromOrder({ pickup_appointment_state: 'confirmada' })).toBe('confirmada')
  })
  test('derives from the raw record when no state emitted', () => {
    expect(pickupAppointmentFromOrder({ pickup_appointment: buyerProposal })).toBe('propuesta')
  })
  test('derives from metadata fallback', () => {
    expect(pickupAppointmentFromOrder({ metadata: { pickup_appointment: confirmed } })).toBe('confirmada')
  })
  test('no appointment → none (degrades gracefully)', () => {
    expect(pickupAppointmentFromOrder({})).toBe('none')
  })
})

test.describe('pickup-appointment · action guards', () => {
  test('seller may confirm a buyer proposal, not its own counter', () => {
    expect(canSellerConfirm(buyerProposal)).toBe(true)
    expect(canSellerConfirm(sellerCounter)).toBe(false)
    expect(canSellerConfirm(confirmed)).toBe(false)
    expect(canSellerConfirm(null)).toBe(false)
  })
  test('buyer may confirm a seller counter, not its own proposal', () => {
    expect(canBuyerConfirm(sellerCounter)).toBe(true)
    expect(canBuyerConfirm(buyerProposal)).toBe(false)
    expect(canBuyerConfirm(confirmed)).toBe(false)
  })
  test('seller may reschedule whenever an appointment exists', () => {
    expect(canSellerReschedule(buyerProposal)).toBe(true)
    expect(canSellerReschedule(confirmed)).toBe(true)
    expect(canSellerReschedule(null)).toBe(false)
    expect(canSellerReschedule({})).toBe(false)
  })
})

test.describe('pickup-appointment · transitions', () => {
  test('legal forward moves', () => {
    expect(canTransition('none', 'propuesta')).toBe(true)
    expect(canTransition('propuesta', 'confirmada')).toBe(true)
    expect(canTransition('confirmada', 'propuesta')).toBe(true) // reschedule re-opens
    expect(canTransition('propuesta', 'propuesta')).toBe(true)  // reschedule keeps propuesta
  })
  test('illegal moves rejected', () => {
    expect(canTransition('none', 'confirmada')).toBe(false)
    expect(canTransition('confirmada', 'confirmada')).toBe(false) // terminal until re-proposed
    expect(canTransition('confirmada', 'none')).toBe(false)
  })
})

test.describe('pickup-appointment · copy (es-MX)', () => {
  test('badges', () => {
    expect(pickupAppointmentBadge('none')).toBe('Sin cita')
    expect(pickupAppointmentBadge('propuesta')).toBe('Pendiente de confirmar')
    expect(pickupAppointmentBadge('confirmada')).toBe('Cita confirmada')
  })
  test('whoActsNext flips on proposed_by', () => {
    expect(whoActsNextPickup(buyerProposal, 'seller')).toContain('Confirma')
    expect(whoActsNextPickup(buyerProposal, 'buyer')).toContain('Esperando')
    expect(whoActsNextPickup(sellerCounter, 'buyer')).toContain('Confirma')
    expect(whoActsNextPickup(sellerCounter, 'seller')).toContain('Esperando')
    expect(whoActsNextPickup(confirmed, 'buyer')).toContain('confirmada')
    expect(whoActsNextPickup(null, 'buyer')).toBe('')
  })
  test('detail line names the slot + state', () => {
    expect(pickupAppointmentDetail(buyerProposal)).toContain('pendiente de confirmar')
    expect(pickupAppointmentDetail(confirmed)).toContain('confirmada')
    expect(pickupAppointmentDetail(null)).toBe('')
  })
  test('window labels + picker options', () => {
    expect(pickupWindowLabel('tarde')).toContain('Tarde')
    expect(pickupWindowLabel('bogus')).toBe('Horario por definir')
    expect(PICKUP_WINDOWS.map(w => w.key)).toEqual(['manana', 'tarde', 'noche'])
  })
  test('date formats from parts (no timezone shift)', () => {
    const s = formatPickupAppointment({ date: '2026-06-13', window: 'tarde' })
    expect(s).toContain('13')
    expect(s).toContain('Tarde')
  })
})
