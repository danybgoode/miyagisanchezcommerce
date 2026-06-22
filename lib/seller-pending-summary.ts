/**
 * Pending-signal summary for the seller dashboard header — pure, next-free.
 *
 * When the redundant horizontal nav row was removed (seller-nav-consolidation
 * S1.2), the Pedidos/Ofertas pending-count badges that lived inside it were
 * replaced by a single compact line. This helper builds that es-MX line from the
 * counts the dashboard page already computes, so the wording (singular/plural)
 * is covered by an api spec instead of living inline in the JSX.
 */

/** Coerce a possibly-bad count to a non-negative integer (NaN/negative → 0). */
function clamp(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * es-MX summary of pending seller work, e.g. "2 pedidos · 1 oferta pendientes".
 * Includes only the non-zero parts; the trailing "pendiente(s)" agrees with the
 * combined total. Returns null when there is nothing pending (render nothing).
 */
export function pendingSummaryText(
  pendingOrdersCount: number,
  pendingOffersCount: number,
): string | null {
  const orders = clamp(pendingOrdersCount)
  const offers = clamp(pendingOffersCount)
  if (orders === 0 && offers === 0) return null

  const parts: string[] = []
  if (orders > 0) parts.push(`${orders} ${orders === 1 ? 'pedido' : 'pedidos'}`)
  if (offers > 0) parts.push(`${offers} ${offers === 1 ? 'oferta' : 'ofertas'}`)

  const suffix = orders + offers === 1 ? 'pendiente' : 'pendientes'
  return `${parts.join(' · ')} ${suffix}`
}
