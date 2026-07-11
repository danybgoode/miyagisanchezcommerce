/**
 * lib/shopify-import-bridge.ts
 *
 * Server-only orchestration for the Shopify connector's ACQUIRE step (epic 03
 * · platform-migrations, Sprint 1 · US-1.1): pulls a shop domain's full
 * catalog + policies text via lib/shopify-mcp-client.ts, maps it
 * (lib/shopify-import.ts), and stages it (lib/supply.ts). Sibling to
 * lib/ml-import-bridge.ts, same fail-closed shape — but unlike ML there's no
 * Medusa-side connection module to bridge to: Shopify's catalog is public,
 * read directly from the shop's own domain, no tokens involved.
 *
 * `stageShopifyBatch` is the ONE place a Shopify supply batch gets created —
 * called by BOTH the seller HTTP route (app/api/sell/shopify/import/fetch)
 * and the seller MCP tool (start_shopify_migration in app/api/ucp/mcp), so
 * agent parity (AGENTS rule #3) never drifts from the web path.
 *
 * server-only. Reads fail CLOSED (empty/failed) — never throws.
 */
import 'server-only'
import { db } from './supabase'
import { normalizeSupplyItem, refreshBatchCounts } from './supply'
import { shopifyProductToIncomingSupplyItem } from './shopify-import'
import { fetchAllShopifyProducts, fetchShopifyPolicies, type ShopifyUcpProduct } from './shopify-mcp-client'

export type ShopifyShopPull = {
  products: ShopifyUcpProduct[]
  policiesText: string | null
  /** true when the catalog pull returned nothing usable at all — distinct from a genuinely empty catalog. */
  failed: boolean
  /** true when MAX_PAGES was hit — the batch is a partial, still-useful pull. */
  truncated: boolean
}

/**
 * Pull a Shopify shop's full catalog + best-effort policy text. Policy fetch
 * failure is NON-FATAL (Story 1.1 acceptance treats it as attached-if-
 * available, not a hard requirement) — a null `policiesText` just means the
 * batch ships without it.
 */
export async function pullShopifyShop(domain: string): Promise<ShopifyShopPull> {
  const [catalog, policiesText] = await Promise.all([
    fetchAllShopifyProducts(domain, { maxItems: 2000 }),
    fetchShopifyPolicies(domain).catch(() => null),
  ])
  return {
    products: catalog.products,
    policiesText,
    failed: catalog.failed,
    truncated: catalog.truncated,
  }
}

export type StageShopifyBatchResult =
  | { ok: true; batchId: string; itemCount: number; truncated: boolean; hasPolicies: boolean }
  | { ok: false; error: string; status: number }

/**
 * Pull + normalize + stage a Shopify shop domain into a new `supply_batches`
 * row (+ its `supply_items`), scoped to the given shop. Callers own auth +
 * the enablement-flag check + domain-shape validation before calling this.
 */
export async function stageShopifyBatch(
  shop: { id: string; slug: string },
  domain: string,
): Promise<StageShopifyBatchResult> {
  const pull = await pullShopifyShop(domain)
  if (pull.failed) {
    return { ok: false, status: 502, error: 'No pudimos leer ese dominio. Verifica que sea una tienda Shopify activa e inténtalo de nuevo.' }
  }
  if (pull.products.length === 0) {
    return { ok: false, status: 404, error: 'No encontramos productos en esa tienda.' }
  }

  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .insert({
      name: `Shopify · ${domain}`,
      source_platform: 'shopify',
      source_mode: 'storefront_mcp',
      listing_type: 'product',
      target_status: 'draft',
      acquisition_settings: {
        shop_domain: domain,
        connected_seller_slug: shop.slug,
        connected_shop_id: shop.id,
        policies_text: pull.policiesText,
        truncated: pull.truncated,
      },
      status: 'reviewing',
    })
    .select('*')
    .single()

  if (batchErr || !batch) {
    return { ok: false, status: 500, error: batchErr?.message ?? 'No se pudo crear el lote.' }
  }

  const rows = pull.products
    .map((product) => ({
      ...normalizeSupplyItem(shopifyProductToIncomingSupplyItem(product), {
        source_platform: 'shopify',
        listing_type: 'product',
      }),
      batch_id: batch.id,
    }))
    .filter((row) => row.listing_title || row.source_url)

  if (rows.length > 0) {
    const { error: itemsErr } = await db.from('supply_items').insert(rows)
    if (itemsErr) {
      await db.from('supply_batches').update({ status: 'failed', error_message: itemsErr.message }).eq('id', batch.id)
      return { ok: false, status: 500, error: itemsErr.message }
    }
  }

  await refreshBatchCounts(batch.id)
  return { ok: true, batchId: batch.id, itemCount: rows.length, truncated: pull.truncated, hasPolicies: !!pull.policiesText }
}
