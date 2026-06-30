import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getMlSellerItems } from '@/lib/ml-import-bridge'
import { mlItemToIncomingSupplyItem } from '@/lib/ml-import'
import { normalizeSupplyItem, refreshBatchCounts } from '@/lib/supply'

/**
 * POST /api/sell/ml/import/fetch — fetch the connected seller's active Mercado
 * Libre listings and stage them as a supply batch for review (epic 03 ·
 * mercadolibre-sync S2 · US-4/US-6). Clerk-authed, gated on `ml.import_enabled`,
 * scoped to the caller's own shop. Items already linked to a Medusa product are
 * staged as 'duplicate' so the review UI can flag them.
 */
export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('ml.import_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { items: mlItems, connected } = await getMlSellerItems(shop.slug, { limit: 50 })
  if (!connected) {
    return NextResponse.json({ error: 'Conecta tu cuenta de Mercado Libre primero.' }, { status: 409 })
  }

  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .insert({
      name: `Mercado Libre · ${shop.name ?? shop.slug}`,
      source_platform: 'mercadolibre',
      source_mode: 'connected_seller',
      listing_type: 'product',
      target_status: 'active',
      acquisition_settings: { connected_seller_slug: shop.slug, connected_shop_id: shop.id },
      status: 'reviewing',
    })
    .select('*')
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: batchErr?.message ?? 'No se pudo crear el lote.' }, { status: 500 })
  }

  const rows = mlItems
    .map((mlItem) => {
      const normalized = normalizeSupplyItem(mlItemToIncomingSupplyItem(mlItem), {
        source_platform: 'mercadolibre',
        listing_type: 'product',
      })
      return {
        ...normalized,
        // Already-linked items are flagged as duplicates up front (US-6 dedupe).
        status: mlItem.already_linked ? ('duplicate' as const) : normalized.status,
        batch_id: batch.id,
      }
    })
    .filter((row) => row.listing_title || row.source_url)

  let inserted: unknown[] = []
  if (rows.length > 0) {
    const { data, error: itemsErr } = await db.from('supply_items').insert(rows).select('*')
    if (itemsErr) {
      await db.from('supply_batches').update({ status: 'failed', error_message: itemsErr.message }).eq('id', batch.id)
      return NextResponse.json({ error: itemsErr.message }, { status: 500 })
    }
    inserted = data ?? []
  }

  const counts = await refreshBatchCounts(batch.id)
  return NextResponse.json({ batchId: batch.id, items: inserted, counts }, { status: 201 })
}
