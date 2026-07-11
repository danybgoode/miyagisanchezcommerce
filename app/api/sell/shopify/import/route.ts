import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { refreshBatchCounts, type SupplyItem } from '@/lib/supply'
import { importApprovedItems } from '@/lib/supply-import'

/**
 * POST /api/sell/shopify/import — import selected items from a Shopify batch
 * into the seller's own Medusa shop (epic 03 · platform-migrations S1 ·
 * US-1.1). Clerk-authed, gated on `migrations.connector_enabled`, scoped to
 * the caller's own shop + batch. Selection is explicit (never bulk-import by
 * omission — same rule as the ML confirm route, cross-review #142).
 *
 * Shopify has no product-linkage table (unlike ML), so dedupe is the
 * default source_url check `importApprovedItems` already provides —
 * sufficient here since a re-run targets the SAME staged batch/items, whose
 * source_url is stable per Shopify product.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('migrations.connector_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as { batchId?: string; itemIds?: string[] } | null
  if (!body?.batchId) return NextResponse.json({ error: 'batchId es requerido.' }, { status: 422 })
  if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) {
    return NextResponse.json({ error: 'Selecciona al menos un producto.' }, { status: 422 })
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

  // Ownership: the batch must belong to THIS seller.
  const ownerSlug = (batch.acquisition_settings as Record<string, unknown> | null)?.connected_seller_slug
  if (batch.source_platform !== 'shopify' || ownerSlug !== shop.slug) {
    return NextResponse.json({ error: 'No autorizado para este lote.' }, { status: 403 })
  }

  await db.from('supply_batches').update({ status: 'importing', error_message: null }).eq('id', batch.id)

  const { data: items, error: itemsErr } = await db
    .from('supply_items')
    .select('*')
    .eq('batch_id', batch.id)
    .in('id', body.itemIds)
    .not('status', 'in', '("imported","duplicate")')
    .limit(2000)
  if (itemsErr) {
    await db.from('supply_batches').update({ status: 'failed', error_message: itemsErr.message }).eq('id', batch.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  const targetStatus = batch.target_status || 'draft'

  const { imported, duplicate, failed } = await importApprovedItems((items ?? []) as SupplyItem[], {
    targetStatus,
    // Attach to the CALLER'S existing shop — never mint an unclaimed seller.
    resolveSeller: async () => ({ sellerSlug: shop.slug, mirrorId: shop.id }),
  })

  if (imported > 0) {
    revalidateTag('shops', 'default')
    revalidateTag('listings', 'default')
  }

  const counts = await refreshBatchCounts(batch.id)
  await db.from('supply_batches').update({
    status: failed > 0 ? 'failed' : 'imported',
    imported_at: new Date().toISOString(),
    error_message: failed > 0 ? `${failed} producto(s) fallaron durante la importación` : null,
  }).eq('id', batch.id)

  return NextResponse.json({ imported, duplicate, failed, counts })
}
