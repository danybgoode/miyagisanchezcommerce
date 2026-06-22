/**
 * lib/ticket-quantity.ts
 *
 * Pure, next-free helpers for the event-admission quantity selector (epic 10,
 * S1.2/S1.3). One source of truth shared by the PDP stepper, the /checkout page,
 * and the UCP checkout-session — so the cap + label math can't drift between the
 * web buyer and an AI agent.
 *
 * Kill-switch: `enabled` is the resolved value of the `events.quantity_enabled`
 * flag (read server-side via lib/flags.ts). When false, every quantity is capped
 * at 1 — today's behavior — regardless of how many seats remain.
 */

export interface TicketQuantityCtx {
  /** Remaining seats from Medusa `manage_inventory` (`null` ⇒ not inventory-tracked). */
  available?: number | null
  /** Resolved `events.quantity_enabled` flag. */
  enabled: boolean
}

function toInt(value: unknown): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? n : 0
}

/**
 * The highest quantity a buyer may select. 1 when the flag is off; otherwise
 * the remaining seats (≥ 1), or unbounded-but-≥1 when inventory isn't tracked.
 */
export function ticketQuantityCap(ctx: TicketQuantityCtx): number {
  if (!ctx.enabled) return 1
  if (ctx.available == null) return Number.MAX_SAFE_INTEGER
  return Math.max(1, toInt(ctx.available))
}

/**
 * Clamp a requested quantity into the legal range `[1, cap]`. A non-positive or
 * non-numeric request floors to 1. Use this at every entry point (PDP, checkout
 * page, UCP) so an out-of-range value can never reach the cart.
 */
export function clampTicketQuantity(requested: unknown, ctx: TicketQuantityCtx): number {
  const cap = ticketQuantityCap(ctx)
  const n = toInt(requested)
  if (n < 1) return 1
  return Math.min(n, cap)
}

/** Centavos → "$1,234.00" in es-MX, matching the rest of the storefront. */
function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
  }).format(cents / 100)
}

/**
 * The buy-CTA / line-total label. For quantity 1 it's just the unit price; for N
 * it spells out the multiplication so the buyer sees what they'll be charged:
 *   "3 × $250.00 = $750.00"
 */
export function ticketTotalLabel(unitCents: number, qty: number, currency: string): string {
  const q = Math.max(1, toInt(qty))
  const unit = formatCents(unitCents, currency)
  if (q === 1) return unit
  return `${q} × ${unit} = ${formatCents(unitCents * q, currency)}`
}
