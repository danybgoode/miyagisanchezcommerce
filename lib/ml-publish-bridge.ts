/**
 * lib/ml-publish-bridge.ts
 *
 * Server-side bridge to the Mercado Libre Medusa module for PUBLISH (epic 03 ·
 * mercadolibre-sync, Sprint 3). Sibling to lib/ml-import-bridge.ts: the backend
 * module owns the ML writes + token (AGENTS rule #1); this calls the internal
 * routes that drive the reconcile seam + the category predictor, and reads the
 * linkage so the UI can show ML state. Tokens never transit the frontend.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Reads fail CLOSED.
 */
import 'server-only'
import type { MlCategoryCandidate, MlLinkView } from './ml-publish'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export type MlPublishResult = {
  ok: boolean
  /** 'already_linked' is a 409 on a create attempt — the link already exists. */
  reason?: 'not_connected' | 'no_category' | 'already_linked' | 'failed'
  action?: string
  created?: boolean
  ml_item_id?: string | null
  permalink?: string | null
  status?: string | null
}

/** Read the product↔ML-item linkage (with publish metadata) for the UI. Fails closed (null). */
export async function getMlProductLink(productId: string): Promise<MlLinkView> {
  if (!productId || !INTERNAL_SECRET) return null
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/ml/links?product_id=${encodeURIComponent(productId)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const d = (await res.json()) as { link?: { ml_item_id?: string; metadata?: Record<string, unknown> | null } | null }
    if (!d.link?.ml_item_id) return null
    const m = (d.link.metadata ?? {}) as Record<string, unknown>
    return {
      ml_item_id: d.link.ml_item_id,
      ml_status: (m.ml_status as string | undefined) ?? null,
      permalink: (m.permalink as string | undefined) ?? null,
      ml_category_id: (m.ml_category_id as string | undefined) ?? null,
      last_synced_at: (m.last_synced_at as string | undefined) ?? null,
    }
  } catch {
    return null
  }
}

/** Predict ML categories for a title (US-9). Returns [] on any failure. */
export async function predictMlCategory(sellerSlug: string, query: string): Promise<MlCategoryCandidate[]> {
  if (!sellerSlug || !query || !INTERNAL_SECRET) return []
  try {
    const params = new URLSearchParams({ seller_slug: sellerSlug, q: query })
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/predict?${params.toString()}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const d = (await res.json()) as { candidates?: MlCategoryCandidate[] }
    return Array.isArray(d.candidates) ? d.candidates : []
  } catch {
    return []
  }
}

/**
 * Best-effort close of a product's linked ML item (the archive/delete hook,
 * US-8). Keyed off the linkage only, so it works after the Medusa product is
 * soft-deleted. Never throws — callers must NOT fail the archive on a ML hiccup.
 */
export async function closeMlProduct(sellerSlug: string, productId: string): Promise<{ ok: boolean }> {
  if (!sellerSlug || !productId || !INTERNAL_SECRET) return { ok: false }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug, product_id: productId, action: 'close' }),
      cache: 'no-store',
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}

/**
 * Publish / sync a product to ML (US-7/US-8) — drives the backend reconcile seam.
 * Maps the backend status codes to a typed reason so the UI can message precisely:
 * 409 not-connected vs already-linked, 422 no-category.
 */
export async function publishMlProduct(
  sellerSlug: string,
  productId: string,
  opts: { categoryId?: string | null } = {},
): Promise<MlPublishResult> {
  if (!sellerSlug || !productId || !INTERNAL_SECRET) return { ok: false, reason: 'failed' }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/ml/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug, product_id: productId, category_id: opts.categoryId ?? null }),
      cache: 'no-store',
    })
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) {
      return {
        ok: true,
        action: d.action as string | undefined,
        created: d.created as boolean | undefined,
        ml_item_id: (d.ml_item_id as string | null | undefined) ?? null,
        permalink: (d.permalink as string | null | undefined) ?? null,
        status: (d.status as string | null | undefined) ?? null,
      }
    }
    // Distinguish the failure on the backend's explicit `code` (not a brittle
    // message substring) — the route tags each 409/422 with a stable code.
    if (res.status === 422 && d.code === 'ML_NO_CATEGORY') return { ok: false, reason: 'no_category' }
    if (res.status === 409) {
      return { ok: false, reason: d.code === 'ML_LINK_CONFLICT' ? 'already_linked' : 'not_connected' }
    }
    return { ok: false, reason: 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
