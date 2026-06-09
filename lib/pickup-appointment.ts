/**
 * Pickup-appointment machine — the single vocabulary for the two-sided
 * propose-and-confirm local-pickup appointment. Pure + next-free so it unit-tests with
 * no network/auth, and so the buyer view, seller view, and (mirrored) the backend order
 * normalizer all read ONE source of truth instead of bouncing the buyer to an external
 * scheduling link.
 *
 * Lifecycle:
 *   (checkout) → propuesta → confirmada                (+ reschedule → propuesta)
 *
 *   propuesta    a slot (date + time window) is proposed, pending the OTHER side's
 *                confirm. The buyer proposes at checkout (proposed_by 'buyer'); a seller
 *                reschedule re-proposes (proposed_by 'seller').
 *   confirmada   both sides agreed. Whoever did NOT propose confirmed it.
 *
 * "Propose-and-confirm" — no slot-inventory engine (Daniel's call). Commerce state lives
 * in Medusa (`order.metadata.pickup_appointment`); this module only reads + names it. The
 * backend `normalizeMedusaOrder` mirrors `derivePickupAppointmentState` inline so the
 * UCP/MCP order object an agent reads carries the same `pickup_appointment_state`. Copy is
 * es-MX to match the live app. Mirrors lib/refund-state.ts.
 */

export type PickupAppointmentState = 'none' | 'propuesta' | 'confirmada'

export type PickupRole = 'buyer' | 'seller'

export type PickupWindow = 'manana' | 'tarde' | 'noche'

/**
 * The `order.metadata.pickup_appointment` record this machine reads. Only the fields the
 * derivation/UI need are typed.
 */
export interface PickupAppointmentLike {
  spot_id?: string | null
  /** 'YYYY-MM-DD'. */
  date?: string | null
  /** A fixed time-window key. */
  window?: string | null
  /** propuesta | confirmada. */
  status?: string | null
  /** Which side made the live proposal: 'buyer' (checkout) | 'seller' (reschedule). */
  proposed_by?: string | null
  proposed_at?: string | null
  confirmed_at?: string | null
}

// ── Derivation ──────────────────────────────────────────────────────────────────

/** Derive the canonical appointment state from the persisted record. Pure. */
export function derivePickupAppointmentState(
  pa: PickupAppointmentLike | null | undefined,
): PickupAppointmentState {
  if (!pa || !pa.status) return 'none'
  if (pa.status === 'confirmada') return 'confirmada'
  if (pa.status === 'propuesta') return 'propuesta'
  return 'none'
}

/**
 * Convenience seam for components/normalizers that hold a (normalized) order. Reads the
 * order's own `pickup_appointment_state` when the normalizer already emitted it, else
 * derives from `pickup_appointment` / `metadata.pickup_appointment`.
 */
export function pickupAppointmentFromOrder(order: {
  pickup_appointment_state?: PickupAppointmentState | null
  pickup_appointment?: PickupAppointmentLike | null
  metadata?: Record<string, unknown> | null
}): PickupAppointmentState {
  if (order.pickup_appointment_state) return order.pickup_appointment_state
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const pa = (order.pickup_appointment ?? meta.pickup_appointment ?? null) as PickupAppointmentLike | null
  return derivePickupAppointmentState(pa)
}

// ── Transitions (guards) ────────────────────────────────────────────────────────

const TRANSITIONS: Record<PickupAppointmentState, readonly PickupAppointmentState[]> = {
  none:       ['propuesta'],
  propuesta:  ['confirmada', 'propuesta'], // confirm, or seller reschedule (re-propose)
  confirmada: ['propuesta'],               // a reschedule re-opens it
}

export function canTransition(from: PickupAppointmentState, to: PickupAppointmentState): boolean {
  if (from === to) return from === 'propuesta' // a reschedule keeps propuesta; confirmada is terminal until re-proposed
  return TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Only the side that did NOT propose may confirm. The seller confirms a buyer's checkout
 * proposal; the buyer confirms a seller's reschedule counter.
 */
export function canSellerConfirm(pa: PickupAppointmentLike | null | undefined): boolean {
  return pa?.status === 'propuesta' && pa?.proposed_by === 'buyer'
}
export function canBuyerConfirm(pa: PickupAppointmentLike | null | undefined): boolean {
  return pa?.status === 'propuesta' && pa?.proposed_by === 'seller'
}
/** A seller may reschedule whenever an appointment exists (proposed or confirmed). */
export function canSellerReschedule(pa: PickupAppointmentLike | null | undefined): boolean {
  return pa?.status === 'propuesta' || pa?.status === 'confirmada'
}

// ── Windows ───────────────────────────────────────────────────────────────────────

const WINDOW_LABEL: Record<PickupWindow, string> = {
  manana: 'Mañana (9:00–13:00)',
  tarde:  'Tarde (13:00–18:00)',
  noche:  'Noche (18:00–21:00)',
}

/** The selectable time windows, in order, for the checkout + reschedule pickers. */
export const PICKUP_WINDOWS: ReadonlyArray<{ key: PickupWindow; label: string }> =
  (Object.keys(WINDOW_LABEL) as PickupWindow[]).map(key => ({ key, label: WINDOW_LABEL[key] }))

export function pickupWindowLabel(window: string | null | undefined): string {
  return WINDOW_LABEL[(window ?? '') as PickupWindow] ?? 'Horario por definir'
}

/**
 * Human-friendly "13 jun 2026 · Tarde (13:00–18:00)" (es-MX). The date is a plain
 * 'YYYY-MM-DD' — parsed from its parts so it never shifts across a timezone.
 */
export function formatPickupAppointment(pa: PickupAppointmentLike | null | undefined): string {
  if (!pa) return ''
  const parts: string[] = []
  if (pa.date && /^\d{4}-\d{2}-\d{2}$/.test(pa.date)) {
    const [y, m, d] = pa.date.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    parts.push(dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }))
  } else if (pa.date) {
    parts.push(pa.date)
  }
  if (pa.window) parts.push(pickupWindowLabel(pa.window))
  return parts.join(' · ')
}

// ── Copy (es-MX, honest — "pendiente de confirmar" until confirmed) ─────────────────

const STATE_BADGE: Record<PickupAppointmentState, string> = {
  none:       'Sin cita',
  propuesta:  'Pendiente de confirmar',
  confirmada: 'Cita confirmada',
}

/** Short badge label for an appointment state (es-MX). */
export function pickupAppointmentBadge(state: PickupAppointmentState): string {
  return STATE_BADGE[state]
}

/**
 * The next-actor line, given the full record + the viewer's role (es-MX). Needs the
 * record (not just the state) because who-acts-next depends on `proposed_by`.
 */
export function whoActsNextPickup(
  pa: PickupAppointmentLike | null | undefined,
  role: PickupRole,
): string {
  const state = derivePickupAppointmentState(pa)
  if (state === 'none') return ''
  if (state === 'confirmada') return 'Cita de recolección confirmada'
  // propuesta — depends on who proposed.
  const byBuyer = pa?.proposed_by === 'buyer'
  if (role === 'seller') {
    return byBuyer
      ? 'Confirma la hora propuesta o propón otra'
      : 'Esperando que el comprador confirme la nueva hora'
  }
  // buyer
  return byBuyer
    ? 'Esperando que el vendedor confirme tu hora'
    : 'Confirma la nueva hora que propuso el vendedor'
}

/** A one-line, state-driven explanation (es-MX) for the order-detail surfaces. */
export function pickupAppointmentDetail(pa: PickupAppointmentLike | null | undefined): string {
  const state = derivePickupAppointmentState(pa)
  if (state === 'none') return ''
  const when = formatPickupAppointment(pa)
  if (state === 'confirmada') return `Cita de recolección confirmada: ${when}.`
  return `Cita de recolección propuesta: ${when} — pendiente de confirmar.`
}
