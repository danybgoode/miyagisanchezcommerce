/**
 * Bulk "apply suggested price" — one item's write, called per-item from the
 * bulk-apply loop (catalog-management epic, Sprint 4 · Story 4.2). Mirrors
 * `lib/listing-status.ts`'s `setListingStatus()`/`deleteListing()`: a real
 * HTTP call to the Medusa backend per item, looped server-side within one
 * incoming Apply request — never N sequential calls from the browser.
 *
 * Reuses profit-analyzer's existing single-item apply-price route verbatim
 * (ownership check, Miyagi write, conditional ML publish-parity push respecting
 * `ml.publish_enabled`, `price_apply` audit event) — zero new backend surface
 * for the write itself; this file only adds the per-item orchestration the
 * bulk pipeline needs.
 *
 * server-only (calls Medusa with the caller's Clerk JWT).
 */
import 'server-only'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

export type ApplySuggestedPriceResult = { ok: true } | { ok: false; error: string }

/**
 * Apply one staged suggested-price row. `patch` is the `{variant_id,
 * price_cents}` the backend's `computeBulkDiff` already validated at stage
 * time (single-variant product, positive integer price) — this call re-hits
 * the SAME ownership + honesty guarantees the single-item apply-price route
 * already enforces (it doesn't trust the staged patch blindly either).
 */
export async function applySuggestedPriceItem(
  productId: string,
  patch: { variant_id: string; price_cents: number },
  targetMarginPct: number,
  ctx: { clerkJwt: string },
): Promise<ApplySuggestedPriceResult> {
  const res = await medusaFetch('/store/sellers/me/profit/apply-price', ctx.clerkJwt, {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      variant_id: patch.variant_id,
      new_price_cents: patch.price_cents,
      target_margin_pct: targetMarginPct,
    }),
  })

  const data = await res.json().catch(() => ({})) as { miyagi?: string; message?: string }
  if (!res.ok || data.miyagi === 'failed') {
    return { ok: false, error: data.message ?? 'Error al aplicar el precio sugerido.' }
  }
  // miyagi:'ok' — the Miyagi write landed regardless of the ML leg's outcome
  // (ok/skipped/failed); the route's own price_apply audit event already
  // recorded that honest partial state, so this bulk-apply result only needs
  // to know whether the row is settled, not re-report the ML detail.
  return { ok: true }
}
