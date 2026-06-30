/**
 * lib/ml-import-bridge.ts
 *
 * Server-side bridge to the Mercado Libre Medusa module for IMPORT (epic 03 ·
 * mercadolibre-sync, Sprint 2). Sibling to lib/ml-connection.ts: the backend
 * module is the source of truth (AGENTS rule #1); this reads the connected
 * seller's ML items and records the S1 product↔ML-item linkage via the internal
 * routes. Tokens never transit the frontend.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Reads fail CLOSED (empty/false).
 */
import 'server-only'
import type { MlImportItem } from './ml-import'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export type MlSellerItemsResult = {
  items: MlImportItem[]
  paging: { total: number; offset: number; limit: number }
  /** false when the seller has no active ML connection (the backend returned 409). */
  connected: boolean
}

const EMPTY: MlSellerItemsResult = { items: [], paging: { total: 0, offset: 0, limit: 0 }, connected: true }

/** Fetch the connected seller's active ML items (import-ready). Fails closed to []. */
export async function getMlSellerItems(
  sellerSlug: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<MlSellerItemsResult> {
  if (!sellerSlug || !INTERNAL_SECRET) return EMPTY
  const params = new URLSearchParams({ seller_slug: sellerSlug })
  if (opts.offset != null) params.set('offset', String(opts.offset))
  if (opts.limit != null) params.set('limit', String(opts.limit))
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/items?${params.toString()}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      cache: 'no-store',
    })
    if (res.status === 409) return { ...EMPTY, connected: false }
    if (!res.ok) return EMPTY
    const d = (await res.json()) as Partial<MlSellerItemsResult>
    return {
      items: Array.isArray(d.items) ? d.items : [],
      paging: d.paging ?? EMPTY.paging,
      connected: true,
    }
  } catch {
    return EMPTY
  }
}

/**
 * Record the S1 product↔ML-item linkage. Treats a 409 (already linked) as
 * success — the link already exists, which is exactly the desired end-state.
 * Returns false only on a real failure.
 */
export async function linkMlProduct(
  sellerSlug: string,
  productId: string,
  mlItemId: string,
): Promise<{ ok: boolean; alreadyLinked: boolean }> {
  if (!sellerSlug || !productId || !mlItemId || !INTERNAL_SECRET) {
    return { ok: false, alreadyLinked: false }
  }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug, product_id: productId, ml_item_id: mlItemId }),
      cache: 'no-store',
    })
    if (res.status === 409) return { ok: true, alreadyLinked: true }
    return { ok: res.ok, alreadyLinked: false }
  } catch {
    return { ok: false, alreadyLinked: false }
  }
}

/** Is this ML item already linked to a Medusa product? (linkage-aware dedupe.) */
export async function mlItemAlreadyImported(mlItemId: string): Promise<boolean> {
  if (!mlItemId || !INTERNAL_SECRET) return false
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/ml/links?ml_item_id=${encodeURIComponent(mlItemId)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return false
    const d = (await res.json()) as { link?: unknown | null }
    return !!d.link
  } catch {
    return false
  }
}
