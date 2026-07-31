/**
 * publication-state.ts — pure, next-free (owned-shop-operating-channel epic,
 * Sprint 3 · Story 3.3, frontend half).
 *
 * The backend now returns two INDEPENDENT channel-membership facts on every
 * listing (`in_operating_channel`, `in_marketplace_channel` — S3 backend,
 * `deriveChannelMembership` in `product-publication.ts`). This module maps that
 * pair to what a seller sees. Per the sprint's build contract these are two
 * separate facts and neither is ever inferred from the other — this file only
 * READS both and joins them into one display state; it never derives one
 * membership boolean from the other.
 *
 * `unsellable` (neither membership) should be structurally unreachable: D2 makes
 * the operating channel a strict superset of the marketplace channel, so a
 * genuinely buyable product is always at least `operating_only`. The state exists
 * anyway so a data gap (a mis-provisioned seller, a stale/degraded read — see
 * `market-medusa.ts#resolveChannelIdsForMarket`'s "both false" fallback) renders
 * as a visible, distinct warning instead of being silently mislabeled "draft" (a
 * different axis — Medusa's native `status`) or swallowed as a normal state. That
 * is the exact confusion Story 3.3 exists to remove.
 */

export type PublicationState = 'published' | 'operating_only' | 'unsellable'

export interface PublicationMembership {
  readonly in_operating_channel: boolean
  readonly in_marketplace_channel: boolean
}

/**
 * `in_marketplace_channel` is checked first only because D2 guarantees it is a
 * subset of `in_operating_channel` — never because one is used to infer the
 * other. Both booleans are read; `unsellable` is what's left when neither holds.
 */
export function derivePublicationState(m: PublicationMembership): PublicationState {
  if (m.in_marketplace_channel) return 'published'
  if (m.in_operating_channel) return 'operating_only'
  return 'unsellable'
}

export const PUBLICATION_STATE_LABEL: Record<PublicationState, string> = {
  published: 'Publicado en el marketplace',
  operating_only: 'Solo en tu tienda',
  unsellable: 'Sin canal de venta',
}

export const PUBLICATION_STATE_HINT: Record<PublicationState, string> = {
  published: 'Visible y comprable en el marketplace de México, y en tu propia tienda.',
  operating_only: 'Comprable en tu tienda; no aparece en el marketplace de México.',
  unsellable: 'Este producto no pertenece a ningún canal de venta — no debería ocurrir. Contacta soporte.',
}

/**
 * What the next publish/unpublish PATCH should send for `publish_to_market`
 * (owned-shop-operating-channel epic, S3.2 · D11). `undefined` for `unsellable`
 * means "no action offered" — publishing an already-broken product doesn't fix
 * the missing operating-channel membership, so the toggle stays inert rather
 * than pretending a click can repair a data gap.
 */
export function nextPublicationRequest(state: PublicationState): 'mx' | null | undefined {
  if (state === 'published') return null // unpublish — remove the marketplace channel only (D11)
  if (state === 'operating_only') return 'mx' // publish — add the marketplace channel
  return undefined
}

/**
 * The `publish_to_market` value the product-create payload should send
 * (owned-shop-operating-channel epic, S3.1). `undefined` (omitted) preserves
 * today's behaviour byte-for-byte — the seller's own market, exactly as before
 * this epic. `null` is the new "solo mi tienda" path, offered only while
 * `catalog.owned_shop_only_enabled` is ON (D8) — the caller is responsible for
 * never reaching the `true` branch with the flag off.
 */
export function createPublishToMarket(ownedShopOnly: boolean): 'mx' | null | undefined {
  return ownedShopOnly ? null : undefined
}

/**
 * The toast message for a failed publish/unpublish PATCH. The backend's own
 * es-MX message wins whenever present — this is only the fallback for a
 * malformed/empty error body. 423 (the capability is switched off — D8) reads
 * as a DIFFERENT fact from 422 (a caller-input refusal, e.g. cross-market or
 * market-not-open) and 503 (the channel is unaddressable, an infra outage): a
 * seller who sees 423 did nothing wrong, so the copy must never blame them the
 * way a 422's "you can't do that" phrasing would.
 */
export function publicationChangeToastMessage(status: number, backendMessage: string | undefined): string {
  if (backendMessage) return backendMessage
  if (status === 423) return 'Publicar o despublicar del marketplace todavía no está disponible en tu cuenta.'
  if (status === 503) return 'El canal del marketplace no está disponible en este momento. Inténtalo más tarde.'
  return 'Error al cambiar la publicación en el marketplace.'
}
