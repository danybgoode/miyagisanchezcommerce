/**
 * Apply a shop-settings patch (profile fields + settings.* blob) to the
 * seller's shop. Mirrors the write in PATCH /api/sell/shop — deep-merges the
 * settings blob into marketplace_shops.metadata.settings and syncs profile +
 * settings to the Medusa seller record so the UCP/MCP layer stays in sync.
 *
 * Kept as a standalone helper (used by the Storefront-as-Code importer) so the
 * live settings route is untouched. If you change the settings-write contract,
 * update both places.
 */

import { db } from './supabase'
import { syncMedusaSellerProfile } from './medusa-seller-sync'
import type { ShopPatchBody } from './settings-import'

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const bv = base[key]
    const ov = override[key]
    if (ov !== null && typeof ov === 'object' && !Array.isArray(ov) &&
        bv !== null && typeof bv === 'object' && !Array.isArray(bv)) {
      result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>)
    } else {
      result[key] = ov
    }
  }
  return result
}

export async function applyShopSettings(
  userId: string,
  clerkJwt: string | null,
  body: ShopPatchBody,
): Promise<{ ok: boolean; error?: string }> {
  const { data: shop, error: fetchErr } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (fetchErr || !shop) return { ok: false, error: 'Tienda no encontrada.' }

  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const existingSettings = (existingMeta.settings ?? {}) as Record<string, unknown>
  const mergedSettings = body.settings
    ? deepMerge(existingSettings, body.settings)
    : existingSettings

  const location = [body.city?.trim(), body.state?.trim()].filter(Boolean).join(', ') || undefined

  const updates: Record<string, unknown> = {
    metadata: { ...existingMeta, settings: mergedSettings },
  }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.description !== undefined) updates.description = body.description.trim() || null
  if (location !== undefined) updates.location = location
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url

  const { error } = await db.from('marketplace_shops').update(updates).eq('id', shop.id)
  if (error) {
    console.error('[apply-shop-settings] update error:', error)
    return { ok: false, error: 'Error al guardar la configuración.' }
  }

  // Mirror profile + settings to the Medusa seller record (non-fatal).
  try {
    if (clerkJwt) {
      const medusaPayload: Record<string, unknown> = {}
      if (body.name !== undefined) medusaPayload.name = body.name.trim()
      if (body.description !== undefined) medusaPayload.description = body.description.trim() || null
      if (location !== undefined) medusaPayload.location = location
      if (body.logo_url !== undefined) medusaPayload.logo_url = body.logo_url
      if (body.settings) medusaPayload.metadata = { settings: mergedSettings }
      if (Object.keys(medusaPayload).length > 0) {
        await syncMedusaSellerProfile(clerkJwt, medusaPayload)
      }
    }
  } catch (e) {
    console.error('[apply-shop-settings] Medusa seller sync failed (non-fatal):', e)
  }

  return { ok: true }
}
