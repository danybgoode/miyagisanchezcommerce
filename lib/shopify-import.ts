/**
 * lib/shopify-import.ts
 *
 * Pure, dependency-free mapping seam for the Shopify UCP catalog connector
 * (epic 03 · platform-migrations, Sprint 1 · US-1.1). Maps a product from a
 * Shopify shop's `/api/ucp/mcp` `search_catalog` response into the supply
 * pipeline's `IncomingSupplyItem`, so the connector rides the existing
 * staging plumbing — same shape as lib/ml-import.ts.
 *
 * The `ShopifyUcpProduct` shape here is CONFIRMED against a live probe of a
 * real Shopify storefront (allbirds.com, 2026-07-11) — not assumed from docs,
 * which under- and mis-described it (see lib/shopify-mcp-client.ts header).
 * Notably: money is already integer MINOR units (no pesos/cents heuristic
 * needed, unlike ML); images live on EACH VARIANT (not reliably at the
 * product top level — some real responses omit product-level `media`
 * entirely); `description` is `{html}` in practice (no `plain` seen live).
 *
 * No next/* and no network imports — the Playwright `api` runner unit-tests it.
 * Every field degrades gracefully: a missing/odd Shopify field never throws.
 */
import type { IncomingSupplyItem } from './supply'
import type { ShopifyUcpProduct, ShopifyUcpVariant, ShopifyUcpMoney } from './shopify-mcp-client'

export type { ShopifyUcpProduct, ShopifyUcpVariant, ShopifyUcpMoney }

/** Parse a Shopify UCP money value (confirmed live: integer minor units, e.g. 11000 = $110.00). */
function moneyToCents(money: ShopifyUcpMoney | null | undefined): number | null {
  if (!money || money.amount === null || money.amount === undefined) return null
  if (typeof money.amount === 'number') {
    return Number.isFinite(money.amount) && money.amount >= 0 ? Math.round(money.amount) : null
  }
  // Defensive only — every live response saw a number, never a string.
  const parsed = Number.parseFloat(String(money.amount).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

function descriptionText(desc: ShopifyUcpProduct['description']): string | undefined {
  if (!desc) return undefined
  if (typeof desc === 'string') return desc.trim() || undefined
  const plain = desc.plain?.trim()
  if (plain) return plain
  const html = desc.html?.trim()
  if (!html) return undefined
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
}

/** Every image across the product's variants, deduped by URL, image-type only. */
function collectImages(product: ShopifyUcpProduct): Array<{ url: string; alt?: string }> {
  const seen = new Set<string>()
  const out: Array<{ url: string; alt?: string }> = []
  const pools = [product.media, ...(Array.isArray(product.variants) ? product.variants.map((v) => v.media) : [])]
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue
    for (const m of pool) {
      if (!m || m.type === 'video' || typeof m.url !== 'string' || !m.url || seen.has(m.url)) continue
      seen.add(m.url)
      out.push({ url: m.url })
    }
  }
  return out
}

/**
 * Every Shopify product migrates in as 'otros' — Shopify's UCP catalog carries
 * no Miyagi-shaped category (live `tags`/`categories` are shop-specific/free-
 * text, not a usable taxonomy); the seller re-categorizes at the review step
 * (same fallback pattern as lib/ml-import.ts's leaf-category default).
 */
export function shopifyCategoryToMiyagi(): 'otros' {
  return 'otros'
}

/** Shopify's catalog is retail-new by construction — no per-listing condition field. */
export function shopifyConditionToMiyagi(): 'new' {
  return 'new'
}

/** Map a UCP catalog product → the supply pipeline's IncomingSupplyItem. */
export function shopifyProductToIncomingSupplyItem(product: ShopifyUcpProduct): IncomingSupplyItem {
  const title = (product.title ?? '').trim()
  const variants = Array.isArray(product.variants) ? product.variants : []
  const images = collectImages(product)
  const priceCents = moneyToCents(product.price_range?.min) ?? moneyToCents(variants[0]?.price)
  const currency =
    product.price_range?.min?.currency?.trim() || variants[0]?.price?.currency?.trim() || 'MXN'
  const anyAvailable = variants.length === 0 || variants.some((v) => v.availability?.available !== false)

  return {
    source_id: product.id ?? product.handle ?? undefined,
    source_url: product.url ?? undefined,
    listing_title: title || undefined,
    listing_description: descriptionText(product.description),
    currency,
    listing_type: 'product',
    category: shopifyCategoryToMiyagi(),
    condition: shopifyConditionToMiyagi(),
    price_cents: priceCents ?? undefined,
    images,
    metadata: {
      shopify_product_id: product.id ?? null,
      shopify_handle: product.handle ?? null,
      shopify_variant_count: variants.length,
      shopify_available: anyAvailable,
      shopify_variants: variants.slice(0, 50).map((v) => ({
        id: v.id ?? null,
        sku: v.sku ?? null,
        title: v.title ?? null,
        price_cents: moneyToCents(v.price),
        available: v.availability?.available ?? null,
      })),
    },
  }
}
