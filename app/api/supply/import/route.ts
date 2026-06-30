import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/supabase'
import { withSupplyAdmin } from '@/lib/admin/guard'
import { refreshBatchCounts, supplyItemToSellerBody, type SupplyItem } from '@/lib/supply'
import { importApprovedItems, type ResolvedImportSeller } from '@/lib/supply-import'
import {
  ensureUnclaimedShopMirror,
  type MedusaSellerForMirror,
} from '@/lib/provisioning'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

type MedusaSeller = MedusaSellerForMirror & {
  clerk_user_id: string | null
  source?: string | null
  source_url?: string | null
}

/**
 * Resolve the item's shop to a REAL Medusa seller (the storefront's only read
 * model) — created unclaimed (clerk_user_id NULL) when new, idempotent on
 * source_url — then make sure the Supabase mirror row exists (conversations /
 * offers / short links read the mirror; non-fatal when it fails).
 */
async function resolveUnclaimedSeller(item: SupplyItem): Promise<ResolvedImportSeller> {
  const res = await fetch(`${MEDUSA_BASE}/internal/sellers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify(supplyItemToSellerBody(item)),
  })
  const data = await res.json().catch(() => ({})) as { seller?: MedusaSeller; message?: string }
  if (!res.ok || !data.seller) {
    throw new Error(`Seller create failed (${res.status}): ${data.message ?? 'no data'}`)
  }

  const mirrorId = await ensureUnclaimedShopMirror(data.seller).catch((e) => {
    console.error('[supply/import] shop mirror failed (non-fatal):', e)
    return null
  })

  return { sellerSlug: data.seller.slug, mirrorId }
}

export const POST = withSupplyAdmin(async (req: NextRequest) => {
  if (!INTERNAL_SECRET) {
    return NextResponse.json({ error: 'MEDUSA_INTERNAL_SECRET is not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => null) as {
    batchId?: string
    targetStatus?: string
  } | null

  if (!body?.batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 422 })

  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .select('*')
    .eq('id', body.batchId)
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: batchErr?.message ?? 'Batch not found' }, { status: 404 })
  }

  const targetStatus = body.targetStatus || batch.target_status || 'active'
  await db.from('supply_batches').update({ status: 'importing', error_message: null }).eq('id', batch.id)

  const { data: items, error: itemsErr } = await db
    .from('supply_items')
    .select('*')
    .eq('batch_id', batch.id)
    .eq('status', 'approved')
    .order('quality_score', { ascending: false })
    .limit(500)

  if (itemsErr) {
    await db.from('supply_batches').update({ status: 'failed', error_message: itemsErr.message }).eq('id', batch.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  const { imported, duplicate, failed } = await importApprovedItems((items ?? []) as SupplyItem[], {
    targetStatus,
    resolveSeller: resolveUnclaimedSeller,
  })

  // Fresh shops/listings should show up without waiting out the ISR window.
  if (imported > 0) {
    revalidateTag('shops', 'default')
    revalidateTag('listings', 'default')
  }

  const counts = await refreshBatchCounts(batch.id)
  const doneStatus = failed > 0 ? 'failed' : 'imported'
  await db.from('supply_batches').update({
    status: doneStatus,
    imported_at: new Date().toISOString(),
    error_message: failed > 0 ? `${failed} row(s) failed during import` : null,
  }).eq('id', batch.id)

  return NextResponse.json({ imported, duplicate, failed, counts })
})
