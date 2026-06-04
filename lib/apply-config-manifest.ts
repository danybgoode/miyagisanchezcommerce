/**
 * Shared Storefront-as-Code apply engine (Sprint 3 + Sprint 4).
 *
 * One pipeline — validate → ingest remote logo/banner into R2 → atomic block
 * apply — used by BOTH the on-site upload route (POST /api/sell/settings-import)
 * and the seller MCP `patch_store_configuration` tool, so a config applied by a
 * file and one applied by an agent go through exactly the same validation and
 * write path. Partial manifests are fine: validateConfig only emits the blocks
 * present, and applyShopSettings deep-merges, so untouched blocks are preserved.
 */

import { validateConfig, type StoreConfigManifest, type BlockResult } from './settings-import'
import { applyShopSettings } from './apply-shop-settings'
import { ingestImageUrls } from './image-ingest'

export interface ApplyConfigResult {
  ok: boolean
  blocks: BlockResult[]
  error?: string
  /** True when at least one block validated and was written. */
  appliedAny: boolean
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
  return { ok: true, blocks, appliedAny: true }
}
