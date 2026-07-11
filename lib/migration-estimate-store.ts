/**
 * lib/migration-estimate-store.ts
 *
 * Server-only DB-facing wrapper around the pure estimator (lib/migration-estimate.ts)
 * and the parity scorer (lib/migration-parity.ts) — epic 03 · platform-migrations,
 * Sprint 2 · US-2.2/US-2.3. Sibling to lib/shopify-import-bridge.ts's
 * `getShopifyBatchParity`: same ownership check, same live-count reads, so a
 * quote's inputs can never drift from what the parity report itself shows.
 *
 * `classifyMigrationPricing` is the ONE place a batch's migration-pricing tier
 * is decided and (for the `estimate` tier) persisted — the seller-facing
 * estimate route and the promoter close route both defer to it, so they can't
 * disagree about which tier a batch is in.
 *
 * server-only. Reads/writes fail closed — never throws.
 */
import 'server-only'
import { db } from './supabase'
import { computeMigrationEstimate } from './migration-estimate'
import { buildParityReport, VERY_CUSTOM_LISTING_THRESHOLD, type ParitySectionKey } from './migration-parity'
import { getPromoterSkuPrices } from './promoter'
import { tg } from './telegram'

export interface MigrationEstimateRow {
  id: string
  batch_id: string
  shop_id: string
  listing_count: number
  image_count: number
  source_platform: string | null
  custom_sections: ParitySectionKey[]
  base_price_cents: number
  overage_cents: number
  section_adder_cents: number
  total_price_cents: number
  created_at: string
}

export type MigrationPricingClassification =
  | { ok: true; tier: 'flat' }
  | { ok: true; tier: 'estimate'; estimate: MigrationEstimateRow }
  | { ok: true; tier: 'very_custom' }
  | { ok: false; error: string; status: number }

/**
 * Load a staged Shopify batch (ownership-scoped to `shop.slug`), classify its
 * migration-pricing tier, and — for the `estimate` tier — reuse an existing
 * quote for this batch if one already exists, else compute + persist a new
 * one. Never recomputes a DIFFERENT quote for the same batch on repeat calls
 * (a seller reloading the estimate page gets the same number, not a fresh
 * roll) unless no row exists yet.
 */
export async function classifyMigrationPricing(
  shop: { slug: string },
  batchId: string,
): Promise<MigrationPricingClassification> {
  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .select('id, source_platform, acquisition_settings')
    .eq('id', batchId)
    .maybeSingle()
  if (batchErr || !batch) return { ok: false, status: 404, error: 'Lote no encontrado.' }

  const settings = (batch.acquisition_settings as Record<string, unknown> | null) ?? {}
  if (batch.source_platform !== 'shopify' || settings.connected_seller_slug !== shop.slug) {
    return { ok: false, status: 403, error: 'No autorizado para este lote.' }
  }
  const shopId = typeof settings.connected_shop_id === 'string' ? settings.connected_shop_id : null
  if (!shopId) return { ok: false, status: 422, error: 'Lote sin tienda asociada.' }

  const { count: listingCount } = await db
    .from('supply_items')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
  const { data: items } = await db
    .from('supply_items')
    .select('images')
    .eq('batch_id', batchId)
  const imageCount = (items ?? []).reduce((sum, item) => {
    const images = (item as { images?: unknown }).images
    return sum + (Array.isArray(images) ? images.length : 0)
  }, 0)

  const report = buildParityReport({
    listingCount: listingCount ?? 0,
    imageCount,
    hasPolicies: !!settings.policies_text,
    truncated: !!settings.truncated,
  })

  // Story 2.3 (very-custom → Daniel) hooks in here — see the follow-up commit;
  // this Story 2.2 slice only decides flat vs. estimate.
  if (report.veryCustom) {
    await notifyVeryCustomOnce(batchId, batch, shopId, report.listingCount)
    return { ok: true, tier: 'very_custom' }
  }
  if (report.listingCount <= VERY_CUSTOM_LISTING_THRESHOLD) {
    return { ok: true, tier: 'flat' }
  }

  const { data: existing } = await db
    .from('marketplace_migration_estimates')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) {
    return { ok: true, tier: 'estimate', estimate: existing as MigrationEstimateRow }
  }

  // The estimate's base MUST read the same admin-set price the flat ≤150 path
  // charges (lib/migration-checkout.ts) — never a hardcoded duplicate (cross-
  // review catch, PR #224). No price configured yet ⇒ refuse rather than quote
  // against a number nobody actually set.
  const prices = await getPromoterSkuPrices()
  const basePriceMxn = prices.migration
  if (basePriceMxn == null) {
    return { ok: false, status: 422, error: 'El precio de migración aún no está configurado.' }
  }

  const customSections = report.sections.filter((s) => s.verdict !== 'mapped').map((s) => s.key)
  const breakdown = computeMigrationEstimate({
    listingCount: report.listingCount,
    customSectionCount: customSections.length,
    basePriceCents: Math.round(basePriceMxn * 100),
  })

  const { data: inserted, error } = await db
    .from('marketplace_migration_estimates')
    .insert({
      batch_id: batchId,
      shop_id: shopId,
      listing_count: report.listingCount,
      image_count: report.imageCount,
      source_platform: batch.source_platform,
      custom_sections: customSections,
      base_price_cents: breakdown.baseCents,
      overage_cents: breakdown.overageCents,
      section_adder_cents: breakdown.sectionAdderCents,
      total_price_cents: breakdown.totalCents,
    })
    .select('*')
    .single()
  if (error || !inserted) {
    return { ok: false, status: 500, error: error?.message ?? 'No se pudo generar la cotización.' }
  }

  return { ok: true, tier: 'estimate', estimate: inserted as MigrationEstimateRow }
}

/** Load a quote by id — used by the promoter close route to price from it. */
export async function getMigrationEstimate(id: string): Promise<MigrationEstimateRow | null> {
  const { data } = await db.from('marketplace_migration_estimates').select('*').eq('id', id).maybeSingle()
  return (data as MigrationEstimateRow | null) ?? null
}

/**
 * Standalone very-custom check + notify, callable directly from the
 * seller-facing parity PAGE — not only from the estimate-generation route.
 *
 * Bug caught in review (PR #224): `classifyMigrationPricing`'s very-custom
 * branch was only ever reached via `POST /api/sell/shopify/import/parity/
 * estimate`, and that route is only ever called by `MigrationEstimateCard`
 * — which the parity page renders ONLY when `!report.veryCustom`. So for
 * the exact batches this story exists to notify on, the notify path was
 * unreachable in the shipped UI: the seller never clicks a button that
 * would trigger it. Story 2.3's acceptance ("when the report trips very
 * custom, Daniel is notified") must fire the moment the report itself is
 * computed — which is page load, not an optional follow-up click. The
 * parity page now calls this directly after rendering the very-custom
 * banner; a truncated pull needs nothing beyond `acquisition_settings`, so
 * this doesn't need the full listing/image-count reads `classifyMigrationPricing`
 * does for the non-very-custom tiers.
 */
export async function notifyIfVeryCustom(batchId: string): Promise<{ veryCustom: boolean }> {
  const { data: batch } = await db
    .from('supply_batches')
    .select('id, acquisition_settings')
    .eq('id', batchId)
    .maybeSingle()
  if (!batch) return { veryCustom: false }

  const settings = (batch.acquisition_settings as Record<string, unknown> | null) ?? {}
  const truncated = !!settings.truncated // the sole veryCustom trigger post-redefinition (lib/migration-parity.ts)
  if (!truncated) return { veryCustom: false }

  const shopId = typeof settings.connected_shop_id === 'string' ? settings.connected_shop_id : null
  if (shopId) {
    const { count: listingCount } = await db
      .from('supply_items')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId)
    await notifyVeryCustomOnce(batchId, batch, shopId, listingCount ?? 0)
  }
  return { veryCustom: true }
}

/**
 * Story 2.3 — notify Daniel once per batch when the report is untrustworthy
 * (truncated pull). Dedupes via a flag on the batch's own
 * `acquisition_settings` (no separate table needed) so re-loading the parity/
 * estimate page repeatedly doesn't re-alert every view.
 */
async function notifyVeryCustomOnce(
  batchId: string,
  batch: { acquisition_settings: unknown },
  shopId: string,
  listingCount: number,
): Promise<void> {
  const settings = (batch.acquisition_settings as Record<string, unknown> | null) ?? {}
  if (settings.very_custom_notified_at) return // already notified for this batch

  // Best-effort, not atomic: this read-then-write has a race window between two
  // concurrent calls for the same batch (both could read "not yet notified" before
  // either writes). Accepted deliberately — Daniel gets at most one extra Telegram
  // ping in that narrow window, never a missed one, and the dedupe still holds for
  // the overwhelmingly common case (repeat page loads, not concurrent ones). A
  // prior version of this guard added a second `.eq(...)` filter attempting to
  // express "only update if still null" — removed (cross-review catch, PR #224):
  // Supabase/PostgREST can't express IS NULL via `.eq()` on a `->>` jsonb path, so
  // it silently matched nothing some of the time and was strictly worse than no
  // guard at all (a false "still not notified" read that then failed to persist).
  const { error } = await db
    .from('supply_batches')
    .update({ acquisition_settings: { ...settings, very_custom_notified_at: new Date().toISOString() } })
    .eq('id', batchId)
  if (error) {
    console.error('[migration-estimate] very-custom dedupe write failed:', error.message)
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  tg.migrationVeryCustom(shopId, listingCount, `${site}/shop/manage/shopify/import/parity/${batchId}`)
    .catch((e) => console.error('[migration-estimate] very-custom notify failed:', e))
}
