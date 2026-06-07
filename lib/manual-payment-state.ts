/**
 * Manual-payment state machine — the single vocabulary for the SPEI / DiMo / cash
 * lifecycle. Pure + next-free so it is unit-testable with no network/auth, and so
 * the buyer view, seller view, inbox, and (mirrored) the backend order normalizer
 * all read ONE source of truth instead of inferring state from local button clicks.
 *
 * Lifecycle:  pending_payment → buyer_reported_paid → payment_confirmed → processing
 *
 *   pending_payment      buyer hasn't paid (or hasn't told us); seller waits.
 *   buyer_reported_paid  buyer pressed "Ya hice el pago" — durable, survives reload.
 *   payment_confirmed    seller confirmed receipt (capture) — funds in.
 *   processing           confirmed AND fulfillment has begun.
 *
 * Commerce state lives in Medusa (`order.metadata`); this module only *reads* and
 * *names* it. Copy is es-MX to match the live app.
 */

export type ManualPaymentState =
  | 'pending_payment'
  | 'buyer_reported_paid'
  | 'payment_confirmed'
  | 'processing'

export type ManualPaymentRole = 'buyer' | 'seller'

/** Payment methods that follow the manual (authorize-now, capture-on-confirm) path. */
export const MANUAL_PAYMENT_METHODS = ['manual', 'spei', 'cash', 'dimo'] as const

export function isManualPaymentMethod(method: string | null | undefined): boolean {
  return MANUAL_PAYMENT_METHODS.includes((method ?? '') as (typeof MANUAL_PAYMENT_METHODS)[number])
}

// ── Derivation ──────────────────────────────────────────────────────────────────

export interface ManualPaymentDeriveInput {
  /** Seller confirmed receipt (metadata.payment_received) OR the payment is captured. */
  paymentConfirmed?: boolean | null
  /** Buyer pressed "Ya hice el pago" (metadata.buyer_reported_paid). */
  buyerReportedPaid?: boolean | null
  /** Fulfillment has advanced beyond "awaiting" (status processing/shipped/…). */
  fulfillmentStarted?: boolean | null
}

/**
 * Derive the canonical state from the raw flags. Confirmation wins (it is the
 * authoritative, capturing action); then a durable buyer report; else pending.
 * Method-agnostic on purpose — callers gate on {@link isManualPaymentMethod}.
 */
export function deriveManualPaymentState(input: ManualPaymentDeriveInput): ManualPaymentState {
  if (input.paymentConfirmed) {
    return input.fulfillmentStarted ? 'processing' : 'payment_confirmed'
  }
  if (input.buyerReportedPaid) return 'buyer_reported_paid'
  return 'pending_payment'
}

/** Fulfillment statuses that mean the seller has begun handing the order off. */
const FULFILLMENT_STARTED_STATUSES = new Set([
  'processing', 'shipped', 'in_transit', 'delivered', 'fulfilled', 'completed',
])

/**
 * Convenience seam for components/normalizers that hold a (normalized) order.
 * Returns `null` for non-manual orders so callers can skip the manual UI entirely.
 */
export function manualPaymentStateFromOrder(order: {
  payment_method?: string | null
  payment_received?: boolean | null
  buyer_reported_paid?: boolean | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}): ManualPaymentState | null {
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const method = order.payment_method ?? (meta.payment_method as string | undefined) ?? null
  if (!isManualPaymentMethod(method)) return null

  return deriveManualPaymentState({
    paymentConfirmed: !!order.payment_received || meta.payment_received === true,
    buyerReportedPaid: !!order.buyer_reported_paid || meta.buyer_reported_paid === true,
    fulfillmentStarted: FULFILLMENT_STARTED_STATUSES.has(order.status ?? ''),
  })
}

// ── Transitions (guards) ────────────────────────────────────────────────────────

/**
 * Legal forward moves. A seller may confirm a payment the buyer never reported
 * (`pending_payment → payment_confirmed`), so that edge is allowed — but jumping
 * straight to `processing` without confirmation is NOT (the acceptance guard).
 * `buyer_reported_paid → pending_payment` allows a false-alarm revert.
 */
const TRANSITIONS: Record<ManualPaymentState, readonly ManualPaymentState[]> = {
  pending_payment:     ['buyer_reported_paid', 'payment_confirmed'],
  buyer_reported_paid: ['payment_confirmed', 'pending_payment'],
  payment_confirmed:   ['processing'],
  processing:          [],
}

export function canTransition(from: ManualPaymentState, to: ManualPaymentState): boolean {
  if (from === to) return true
  return TRANSITIONS[from]?.includes(to) ?? false
}

// ── Copy (es-MX, matches the live app) ────────────────────────────────────────────

const WHO_ACTS_NEXT: Record<ManualPaymentState, Record<ManualPaymentRole, string>> = {
  pending_payment: {
    buyer:  'Paga ahora',
    seller: 'Esperando pago',
  },
  buyer_reported_paid: {
    buyer:  'Avisaste — el vendedor verifica',
    seller: 'Verifica el pago reportado',
  },
  payment_confirmed: {
    buyer:  'Pago confirmado',
    seller: 'Prepara la entrega',
  },
  processing: {
    buyer:  'El vendedor prepara tu pedido',
    seller: 'Prepara la entrega',
  },
}

/** The next-actor line for a given state + role (es-MX). */
export function whoActsNext(state: ManualPaymentState, role: ManualPaymentRole): string {
  return WHO_ACTS_NEXT[state][role]
}

const STATE_BADGE: Record<ManualPaymentState, string> = {
  pending_payment:     'Pago pendiente',
  buyer_reported_paid: 'Pago reportado — en verificación',
  payment_confirmed:   'Pago confirmado',
  processing:          'En preparación',
}

/** Short badge label for a state (es-MX). */
export function manualPaymentBadge(state: ManualPaymentState): string {
  return STATE_BADGE[state]
}

// ── Ship gate ─────────────────────────────────────────────────────────────────────

/** es-MX reason shown / returned when a seller tries to ship an unpaid manual order. */
export const SHIP_BLOCKED_REASON = 'Aún no confirmas el pago de este pedido.'
/** Shorter, action-oriented variant for the seller UI affordance. */
export const SHIP_BLOCKED_UI_NOTE = 'Esperando pago — confirma el depósito antes de enviar.'

/**
 * A seller may ship only once a manual (SPEI/DiMo/cash) order's payment is confirmed.
 * Card/MP orders are captured at checkout → always shippable. The single source of
 * truth for both the UI affordance (S2.1) and the server gates (S2.2).
 */
export function canSellerShip(order: {
  payment_method?: string | null
  payment_received?: boolean | null
  metadata?: Record<string, unknown> | null
}): boolean {
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const method = order.payment_method ?? (meta.payment_method as string | undefined) ?? null
  if (!isManualPaymentMethod(method)) return true
  return !!order.payment_received || meta.payment_received === true
}
