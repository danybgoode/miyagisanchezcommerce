/**
 * Shared Storefront-as-Code apply engine (Sprint 3 + Sprint 4).
 *
 * One pipeline — validate → ingest remote logo/banner into R2 → atomic block
 * apply — used by BOTH the on-site upload route (POST /api/sell/settings-import)
 * and the seller MCP `patch_store_configuration` tool, so a config applied by a
 * file and one applied by an agent go through exactly the same validation and
 * write path. Partial manifests are fine: validateConfig only emits the blocks
 * present, and applyShopSettings deep-merges, so untouched blocks are preserved.
 *
 * The `support` block (mcp-parity-core S4.1) is the one block with a REAL side
 * effect: enabling it live-provisions a Medusa support product (through the
 * same reuse-first backend core the portal uses) BEFORE any settings write —
 * a provisioning failure aborts the whole apply, mirroring the portal route's
 * 502-without-write semantics. The provisioned id is stamped server-side into
 * `settings.support.support_product_id` (caller input for it is always
 * dropped in validateConfig) and reported back so callers can tell the user a
 * real product was created, not just that "config was applied."
 */

import { validateConfig, type StoreConfigManifest, type BlockResult } from './settings-import'
import { applyShopSettings } from './apply-shop-settings'
import { ingestImageUrls } from './image-ingest'
import { ensureSupportProductViaInternal } from './seller-products'
import { db } from './supabase'

export interface ApplyConfigResult {
  ok: boolean
  blocks: BlockResult[]
  error?: string
  /** True when at least one block validated and was written. */
  appliedAny: boolean
  /** Set when this apply provisioned (or re-confirmed) the shop's support product. */
  supportProduct?: { product_id: string; reused: boolean }
}

export async function applyStoreConfig(
  userId: string,
  clerkJwt: string | null,
  manifest: StoreConfigManifest,
): Promise<ApplyConfigResult> {
  // Re-validate server-side — never trust the caller (client OR agent).
  const { blocks, patch, assets } = validateConfig(manifest)
  const appliedBlocks = blocks.filter((b) => b.status === 'applied')

  if (appliedBlocks.length === 0) {
    return { ok: false, blocks, appliedAny: false, error: 'No encontramos configuración válida para aplicar. Revisa los datos.' }
  }

  // ── support enable ⇒ provision the real product FIRST (portal semantics:
  // a provisioning failure means nothing is written at all) ───────────────────
  let supportProduct: { product_id: string; reused: boolean } | undefined
  const supportPatch = patch.settings?.support as { enabled?: boolean } | undefined
  if (supportPatch?.enabled === true) {
    const { data: shopRow, error: shopErr } = await db
      .from('marketplace_shops')
      .select('slug')
      .eq('clerk_user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    // Distinguish an infrastructure failure from a genuinely missing shop —
    // collapsing both into "not found" hides real outages (Codex catch).
    if (shopErr) {
      console.error('[apply-config] shop lookup failed:', shopErr)
      return { ok: false, blocks, appliedAny: false, error: 'No se pudo consultar la tienda para aprovisionar los apoyos. Intenta de nuevo.' }
    }
    const slug = shopRow?.slug as string | undefined
    if (!slug) {
      return { ok: false, blocks, appliedAny: false, error: 'Tienda no encontrada para aprovisionar el producto de apoyos.' }
    }
    const provision = await ensureSupportProductViaInternal(slug)
    if (!provision.ok || !provision.product_id) {
      // Abort BEFORE any settings write — appliedAny false (nothing written).
      return { ok: false, blocks, appliedAny: false, error: provision.error ?? 'No se pudo preparar el producto de apoyos.' }
    }
    supportProduct = { product_id: provision.product_id, reused: provision.reused === true }
    ;(patch.settings!.support as Record<string, unknown>).support_product_id = provision.product_id
  }

  // Pull remote logo/banner URLs into our R2 storage so brand assets don't
  // depend on the source host. Graceful — a failed fetch keeps the original URL
  // (already in `patch`); never blocks the apply.
  const assetUrls = [assets.logo_url, assets.banner_url].filter(Boolean) as string[]
  if (assetUrls.length > 0) {
    const ing = await ingestImageUrls(userId, assetUrls, patch.name ?? 'tienda')
    let i = 0
    if (assets.logo_url) { patch.logo_url = ing.images[i]?.url ?? patch.logo_url; i++ }
    if (assets.banner_url) {
      const url = ing.images[i]?.url
      const theme = patch.settings?.theme as Record<string, unknown> | undefined
      if (url && theme) theme.banner_url = url
      i++
    }
  }

  const result = await applyShopSettings(userId, clerkJwt, patch)
  if (!result.ok) {
    return { ok: false, blocks, appliedAny: true, error: result.error ?? 'No se pudo aplicar la configuración.' }
  }
  return { ok: true, blocks, appliedAny: true, ...(supportProduct ? { supportProduct } : {}) }
}
