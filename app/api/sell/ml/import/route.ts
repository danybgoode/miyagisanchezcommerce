import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { refreshBatchCounts, type SupplyItem } from '@/lib/supply'
import { importApprovedItems } from '@/lib/supply-import'
import { linkMlProduct, mlItemAlreadyImported } from '@/lib/ml-import-bridge'

/**
 * POST /api/sell/ml/import — import selected items from a connected-seller ML
 * batch into the seller's own Medusa shop, recording the S1 product↔ML-item
 * linkage for each (epic 03 · mercadolibre-sync S2 · US-4). Clerk-authed, gated
 * on `ml.import_enabled`, scoped to the caller's own shop + batch.
 *
 * Dedupe is linkage-aware: an item already linked to a product (or whose listing
 * already exists by source_url) is skipped, so re-running never double-creates.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('ml.import_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as { batchId?: string; itemIds?: string[] } | null
  if (!body?.batchId) return NextResponse.json({ error: 'batchId es requerido.' }, { status: 422 })
  // Selection is explicit: never bulk-import by omission (cross-review #142).
  if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) {
    return NextResponse.json({ error: 'Selecciona al menos una publicación.' }, { status: 422 })
  }

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .select('*')
    .eq('id', body.batchId)
    .single()
  if (batchErr || !batch) return NextResponse.json({ error: 'Lote no encontrado.' }, { status: 404 })

  // Ownership: the batch must belong to THIS connected seller.
  const ownerSlug = (batch.acquisition_settings as Record<string, unknown> | null)?.connected_seller_slug
  if (batch.source_platform !== 'mercadolibre' || ownerSlug !== shop.slug) {
    return NextResponse.json({ error: 'No autorizado para este lote.' }, { status: 403 })
  }

  await db.from('supply_batches').update({ status: 'importing', error_message: null }).eq('id', batch.id)

  // Import only the explicitly selected items (the review selection); never
  // re-touch an already-imported/duplicate row.
  const { data: items, error: itemsErr } = await db
    .from('supply_items')
    .select('*')
    .eq('batch_id', batch.id)
    .in('id', body.itemIds)
    .not('status', 'in', '("imported","duplicate")')
    .limit(500)
  if (itemsErr) {
    await db.from('supply_batches').update({ status: 'failed', error_message: itemsErr.message }).eq('id', batch.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  const targetStatus = batch.target_status || 'active'

  const { imported, duplicate, failed } = await importApprovedItems((items ?? []) as SupplyItem[], {
    targetStatus,
    // Attach to the CONNECTED seller's existing shop (slug + mirror row) — never
    // mint an unclaimed seller.
    resolveSeller: async () => ({ sellerSlug: shop.slug, mirrorId: shop.id }),
    // Linkage is the authoritative dedupe; the source_url listing check is a
    // fallback so a failed link-record on a prior run can't double-create.
    checkDuplicate: async (item) => {
      if (item.source_id && (await mlItemAlreadyImported(item.source_id))) return { duplicate: true }
      if (item.source_url) {
        const { data } = await db
          .from('marketplace_listings')
          .select('id')
          .eq('source_url', item.source_url)
          .maybeSingle()
        if (data) return { duplicate: true, existingListingId: data.id }
      }
      return { duplicate: false }
    },
    // Best-effort linkage: the product is already created + mirrored, so a failed
    // link must NOT fail the item (that would mark it 'failed' while the product
    // exists, and a retry could create a second one). The source_url dedupe
    // fallback above still catches the re-import; the unlinked product is a soft
    // gap a reconciliation can re-link. (cross-review #142.)
    afterCreate: async (productId, item) => {
      if (!item.source_id) return
      const r = await linkMlProduct(shop.slug, productId, item.source_id)
      if (!r.ok) console.error(`[ml/import] linkage record failed for product ${productId} / ${item.source_id}`)
    },
  })

  if (imported > 0) {
    revalidateTag('shops', 'default')
    revalidateTag('listings', 'default')
  }

  const counts = await refreshBatchCounts(batch.id)
  await db.from('supply_batches').update({
    status: failed > 0 ? 'failed' : 'imported',
    imported_at: new Date().toISOString(),
    error_message: failed > 0 ? `${failed} fila(s) fallaron durante la importación` : null,
  }).eq('id', batch.id)

  return NextResponse.json({ imported, duplicate, failed, counts })
}
