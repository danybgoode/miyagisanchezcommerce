/**
 * Pending-signal summary for the seller dashboard header — pure, next-free.
 *
 * When the redundant horizontal nav row was removed (seller-nav-consolidation
 * S1.2), the Pedidos/Ofertas pending-count badges that lived inside it were
 * replaced by a single compact line. This helper builds that es-MX line from the
 * counts the dashboard page already computes, so the wording (singular/plural)
 * is covered by an api spec instead of living inline in the JSX.
 */

/** One linked part of the summary, e.g. "2 pedidos" → /shop/manage/orders. */
export interface PendingSegment {
  text: string
  href: string
}

export interface PendingSummary {
  /** Non-zero parts, each routing to its own section (orders vs offers). */
  segments: PendingSegment[]
  /** "pendiente" / "pendientes", agreeing with the combined total. */
  suffix: string
}

/** Coerce a possibly-bad count to a non-negative integer (NaN/negative → 0). */
function clamp(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * Structured es-MX summary of pending seller work. Each segment links to its own
 * destination — Pedidos → orders, Ofertas → offers — so the line routes correctly
 * when only offers are pending (the old separate badges each had their own link).
 * Returns null when there is nothing pending (render nothing).
 */
export function pendingSummary(
  pendingOrdersCount: number,
  pendingOffersCount: number,
): PendingSummary | null {
  const orders = clamp(pendingOrdersCount)
  const offers = clamp(pendingOffersCount)
  if (orders === 0 && offers === 0) return null

  const segments: PendingSegment[] = []
  if (orders > 0) {
    segments.push({ text: `${orders} ${orders === 1 ? 'pedido' : 'pedidos'}`, href: '/shop/manage/orders' })
  }
  if (offers > 0) {
    segments.push({ text: `${offers} ${offers === 1 ? 'oferta' : 'ofertas'}`, href: '/shop/manage/offers' })
  }

  return { segments, suffix: orders + offers === 1 ? 'pendiente' : 'pendientes' }
}

/**
 * Flat es-MX string of the same summary, e.g. "2 pedidos · 1 oferta pendientes"
 * (no routing). Convenience for non-linked renders + pluralization coverage.
 */
export function pendingSummaryText(
  pendingOrdersCount: number,
  pendingOffersCount: number,
): string | null {
  const s = pendingSummary(pendingOrdersCount, pendingOffersCount)
  if (!s) return null
  return `${s.segments.map((seg) => seg.text).join(' · ')} ${s.suffix}`
}
