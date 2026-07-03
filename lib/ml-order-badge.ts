/**
 * ML order source badge — ml-orders-native S1 · US-3. Pure + next-free so it's
 * unit-testable with no auth/network, mirroring the `manual-payment-state.ts`
 * convention. Reads the `source`/`ml_order_id`/`ml_pack_id` top-level fields the
 * backend's `normalizeMedusaOrder` already curates from `order.metadata`
 * (stamped by `materializeMlOrder`) — never re-derives from raw metadata here.
 *
 * `source` is a DIFFERENT axis from `lib/channel.ts`'s buyer-traffic `channel`
 * (marketplace/custom_domain/embed/api) — this is "which marketplace sold this"
 * (Mercado Libre vs Miyagi itself), not where the buyer clicked from.
 */

export type MlOrderSourceFields = {
  source?: string | null
  ml_order_id?: string | null
  ml_pack_id?: string | null
}

/** Whether this order came from Mercado Libre (vs a native Miyagi sale). */
export function isMlOrder(order: MlOrderSourceFields): boolean {
  return order.source === 'mercadolibre'
}

/** The house-token badge label to render next to the order status badge, or null when N/A. */
export function mlOrderBadgeLabel(order: MlOrderSourceFields): string | null {
  return isMlOrder(order) ? 'Mercado Libre' : null
}
