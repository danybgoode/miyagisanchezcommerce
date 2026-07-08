/**
 * Transaction ledger — a READ-ONLY projection that resolves the one shared
 * order / payment / refund state behind a conversation into a durable card view.
 *
 * The chat used to be an action bar: `purchase_complete`/`shipped`/`delivered`
 * flashed by as ephemeral pills and "whose turn is it" was implied only by which
 * buttons rendered. This seam instead *projects* state Medusa already owns — it
 * never persists, never mutates, never adds a table. It composes the existing
 * single-source machines:
 *   - {@link manualPaymentStateFromOrder} (#3b) — SPEI/DiMo/cash payment lifecycle.
 *   - {@link refundStateFromOrder} (Epic B) — two-sided off-platform refund ladder.
 *   - {@link offerTurn} — negotiation turn-owner + deadline.
 *
 * It is pure + next-free so the buyer view, seller view, and a unit spec all read
 * ONE projection. Actions are *intents* the component turns into deep-links to the
 * existing order page — the ledger itself carries no mutation path (the in-chat
 * read-only invariant). Copy is es-MX to match the live app.
 *
 * Graceful degrade by construction: no order ⇒ offer-only view; no return request
 * ⇒ `refundStateFromOrder` returns `'none'` so no refund row appears; no offer AND
 * no order ⇒ an empty view. Nothing assumes a field is present.
 */

import {
  manualPaymentStateFromOrder,
  manualPaymentBadge,
  whoActsNext as manualWhoActsNext,
  type ManualPaymentRole,
} from './manual-payment-state'
import {
  refundStateFromOrder,
  refundBadge,
  whoActsNextRefund,
  refundStateDetail,
  type RefundState,
  type ReturnRequestLike,
} from './refund-state'
import { offerTurn, offerStatusLabel, type OfferStatus } from './offers'
import { formatRentalBookingLines, type RentalBookingLike, type RentalBookingState } from './rental-booking'

export type LedgerRole = ManualPaymentRole // 'buyer' | 'seller'

// ── Inputs (all optional/null-safe) ───────────────────────────────────────────────

export interface LedgerOffer {
  status: OfferStatus
  offer_amount_cents: number
  counter_amount_cents?: number | null
  expires_at: string
  counter_expires_at?: string | null
  checkout_expires_at?: string | null
  currency?: string | null
}

/** The (merged/normalized) order shape the payment + refund seams read. */
export interface LedgerOrder {
  payment_method?: string | null
  payment_received?: boolean | null
  buyer_reported_paid?: boolean | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  refund_state?: RefundState | null
  return_request?: ReturnRequestLike | null
  /** Print-proof sign-off (custom-print-products S4 · 4.1) — advisory only,
   *  never changes the dominant stage; just appends a detail line. */
  proof_sent?: boolean | null
  proof_approved?: boolean | null
  /** Rental line-item pricing (epic 02) — advisory only, same as proof above:
   *  never changes the dominant stage, just appends dates + total to the detail. */
  rental_booking?: RentalBookingLike | null
  rental_booking_state?: RentalBookingState | null
  currency?: string | null
}

export interface LedgerInput {
  offer?: LedgerOffer | null
  order?: LedgerOrder | null
  /** Explicit refund-state override; falls back to deriving from the order. Null-safe. */
  refundState?: RefundState | null
  role: LedgerRole
}

// ── Output ─────────────────────────────────────────────────────────────────────────

export type LedgerStage = 'empty' | 'negotiation' | 'payment' | 'fulfillment' | 'refund'

export type LedgerRowStatus = 'done' | 'current' | 'pending'

export interface LedgerRow {
  key: 'negotiation' | 'payment' | 'fulfillment' | 'refund'
  label: string
  status: LedgerRowStatus
}

/**
 * A suggested next action. The ledger is read-only: `kind` is informational and the
 * component renders it as a deep-link to the existing order page (no in-chat mutation).
 */
export interface LedgerAction {
  kind:
    | 'pay'
    | 'confirm-payment'
    | 'respond-refund'
    | 'mark-transferred'
    | 'confirm-refund'
    | 'view-order'
  label: string
}

export interface LedgerView {
  stage: LedgerStage
  /** Headline badge (es-MX). */
  badge: string
  /** Optional one-line context (es-MX). */
  detail?: string
  /** Whose-turn-is-it line (es-MX). */
  whoActsNext: string
  /** The deadline ISO to count down against (negotiation stage only), or null. */
  deadlineIso: string | null
  /** Ordered timeline rows: negotiation → payment → fulfillment → refund. */
  timeline: LedgerRow[]
  /** Suggested action — read-only, deep-links out. Null when nothing to do. */
  action: LedgerAction | null
  /** True when there is neither an order nor an offer to show. */
  isEmpty: boolean
}

// ── Timeline row derivations ─────────────────────────────────────────────────────

const FULFILLMENT_DONE = new Set(['delivered', 'fulfilled', 'completed'])
const FULFILLMENT_ACTIVE = new Set(['processing', 'shipped', 'in_transit'])

function negotiationRowStatus(status: OfferStatus): LedgerRowStatus {
  if (status === 'pending' || status === 'countered') return 'current'
  return 'done' // accepted/paid/declined/withdrawn/expired are all resolved
}

function paymentRowStatus(order: LedgerOrder): LedgerRowStatus {
  const manual = manualPaymentStateFromOrder(order)
  if (manual === null) return 'done' // card / MP — captured at checkout
  if (manual === 'payment_confirmed' || manual === 'processing') return 'done'
  return 'current' // pending_payment | buyer_reported_paid
}

function fulfillmentRowStatus(order: LedgerOrder): LedgerRowStatus {
  const s = order.status ?? ''
  if (FULFILLMENT_DONE.has(s)) return 'done'
  if (FULFILLMENT_ACTIVE.has(s)) return 'current'
  return 'pending'
}

function refundRowStatus(refund: RefundState): LedgerRowStatus {
  if (refund === 'confirmado' || refund === 'rechazado') return 'done'
  return 'current'
}

// ── Action derivations (read-only intents) ───────────────────────────────────────

function manualAction(
  state: ReturnType<typeof manualPaymentStateFromOrder>,
  role: LedgerRole,
): LedgerAction {
  if (state === 'pending_payment' && role === 'buyer') return { kind: 'pay', label: 'Ya hice el pago' }
  if (state === 'buyer_reported_paid' && role === 'seller') return { kind: 'confirm-payment', label: 'Confirmar pago' }
  return { kind: 'view-order', label: 'Ver pedido' }
}

function refundAction(refund: RefundState, role: LedgerRole): LedgerAction | null {
  if (refund === 'solicitado' && role === 'seller') return { kind: 'respond-refund', label: 'Responder devolución' }
  if (refund === 'aceptado' && role === 'seller') return { kind: 'mark-transferred', label: 'Marcar transferencia' }
  if (refund === 'transferencia_pendiente' && role === 'buyer') return { kind: 'confirm-refund', label: 'Confirmar reembolso' }
  if (refund === 'confirmado' || refund === 'rechazado') return null
  return { kind: 'view-order', label: 'Ver pedido' }
}

/**
 * Print-proof sign-off (custom-print-products S4 · 4.1) — advisory only, so
 * it never picks the dominant stage; it only ever appends a one-line detail
 * onto whichever stage already won. Absent when neither flag is set.
 */
function proofDetailLine(order: LedgerOrder): string | undefined {
  if (order.proof_approved) return '✓ Prueba aprobada'
  if (order.proof_sent) return 'Prueba enviada — esperando aprobación'
  return undefined
}

function withProofDetail(view: LedgerView, order: LedgerOrder | null | undefined): LedgerView {
  const line = order ? proofDetailLine(order) : undefined
  if (!line) return view
  return { ...view, detail: view.detail ? `${view.detail} · ${line}` : line }
}

/**
 * Rental line-item pricing (epic 02) — advisory only, same contract as
 * `withProofDetail` above: never picks the dominant stage, just appends the
 * dates + total onto whichever stage already won. Absent for a non-rental order.
 */
function rentalDetailLine(order: LedgerOrder): string | undefined {
  if (!order.rental_booking) return undefined
  const lines = formatRentalBookingLines(order.rental_booking, order.currency ?? 'MXN')
  return `📅 ${lines.dates} · ${lines.total}`
}

function withRentalDetail(view: LedgerView, order: LedgerOrder | null | undefined): LedgerView {
  const line = order ? rentalDetailLine(order) : undefined
  if (!line) return view
  return { ...view, detail: view.detail ? `${view.detail} · ${line}` : line }
}

// ── The projection ───────────────────────────────────────────────────────────────

export function buildTransactionLedger(input: LedgerInput): LedgerView {
  const { offer, order, role } = input
  const hasOffer = !!offer
  const hasOrder = !!order
  const refund: RefundState = input.refundState ?? (order ? refundStateFromOrder(order) : 'none')

  // ── Empty: nothing linked yet ──
  if (!hasOffer && !hasOrder) {
    return {
      stage: 'empty', badge: 'Sin actividad', whoActsNext: '',
      deadlineIso: null, timeline: [], action: null, isEmpty: true,
    }
  }

  // ── Timeline (ordered) ──
  const timeline: LedgerRow[] = []
  if (hasOffer) {
    timeline.push({ key: 'negotiation', label: 'Negociación', status: negotiationRowStatus(offer!.status) })
  }
  if (hasOrder) {
    timeline.push({ key: 'payment', label: 'Pago', status: paymentRowStatus(order!) })
    timeline.push({ key: 'fulfillment', label: 'Entrega', status: fulfillmentRowStatus(order!) })
  }
  if (refund !== 'none') {
    timeline.push({ key: 'refund', label: 'Reembolso', status: refundRowStatus(refund) })
  }

  // ── Dominant stage / headline — refund > payment/fulfillment > negotiation ──
  if (refund !== 'none') {
    return withRentalDetail(withProofDetail({
      stage: 'refund',
      badge: refundBadge(refund),
      detail: refundStateDetail(refund) || undefined,
      whoActsNext: whoActsNextRefund(refund, role),
      deadlineIso: null,
      timeline,
      action: refundAction(refund, role),
      isEmpty: false,
    }, order), order)
  }

  if (hasOrder) {
    const manual = manualPaymentStateFromOrder(order!)
    if (manual) {
      return withRentalDetail(withProofDetail({
        stage: manual === 'processing' ? 'fulfillment' : 'payment',
        badge: manualPaymentBadge(manual),
        whoActsNext: manualWhoActsNext(manual, role),
        deadlineIso: null,
        timeline,
        action: manualAction(manual, role),
        isEmpty: false,
      }, order), order)
    }
    // Card / MP order — captured at checkout, so payment is settled.
    return withRentalDetail(withProofDetail({
      stage: 'fulfillment',
      badge: 'Pago confirmado',
      whoActsNext: role === 'seller' ? 'Prepara la entrega' : 'El vendedor prepara tu pedido',
      deadlineIso: null,
      timeline,
      action: { kind: 'view-order', label: 'Ver pedido' },
      isEmpty: false,
    }, order), order)
  }

  // ── Offer-only (no order yet) ──
  const turn = offerTurn(offer!, role)
  return {
    stage: 'negotiation',
    badge: offerStatusLabel(offer!.status),
    whoActsNext: turn.line,
    deadlineIso: turn.deadlineIso,
    timeline,
    action: null,
    isEmpty: false,
  }
}
