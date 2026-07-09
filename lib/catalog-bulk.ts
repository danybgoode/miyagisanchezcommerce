/**
 * Catalog bulk-action pipeline — catalog-management epic, Sprint 3 · Story 3.1.
 * server-only: calls the backend's bulk-stage/bulk-apply routes (Clerk JWT)
 * and persists staged batches into Supabase (`catalog_bulk_batches` /
 * `catalog_bulk_batch_items` / `catalog_bulk_audit_log`) — staging state is
 * operational/presentation, not commerce truth (AGENTS rule 2); the actual
 * product mutation happens in the backend via `updateSellerProduct()` or
 * (for `pause_activate`) `lib/listing-status.ts`'s `setListingStatus()`.
 */
import 'server-only'
import { db } from '@/lib/supabase'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

export type BulkActionPayload =
  | { type: 'price_set'; price_cents: number }
  | { type: 'price_pct'; percent: number }
  | { type: 'pause_activate'; status: 'active' | 'paused' }

export interface BulkFilterParams {
  q?: string
  category?: string
  channel?: 'miyagi' | 'ml'
  stock?: 'in_stock' | 'agotado' | 'unlimited'
  status?: 'activo' | 'agotado' | 'borrador' | 'pausado' | 'sobre_pedido'
  sort?: 'recent' | 'title' | 'price_asc' | 'price_desc'
}

export interface BulkDiffItem {
  id: string
  title: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  patch: Record<string, unknown> | null
  valid: boolean
  error: string | null
}

export type StageResult =
  | { ok: true; batch_id: string; total: number; valid_count: number; invalid_count: number }
  | { ok: false; status: number; error: string }

/**
 * Stage a bulk action: resolve target products (via the backend, which
 * re-runs the SAME filter/sort logic the catalog table uses), persist the
 * batch + per-item diff into Supabase. Nothing is written to Medusa here.
 */
export async function stageBulkAction(
  ctx: { userId: string; clerkJwt: string },
  target: { filter?: BulkFilterParams; ids?: string[] },
  action: BulkActionPayload,
): Promise<StageResult> {
  const res = await medusaFetch('/store/sellers/me/products/bulk-stage', ctx.clerkJwt, {
    method: 'POST',
    body: JSON.stringify({ filter: target.filter ?? null, ids: target.ids ?? null, action }),
  })

  if (res.status === 423) return { ok: false, status: 423, error: 'Esta función aún no está disponible.' }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, status: res.status, error: body.message ?? 'Error al preparar el lote.' }
  }

  const data = await res.json() as { total: number; valid_count: number; invalid_count: number; items: BulkDiffItem[] }

  const { data: batch, error: batchError } = await db
    .from('catalog_bulk_batches')
    .insert({
      seller_id: ctx.userId,
      actor_type: 'seller',
      actor_id: ctx.userId,
      action,
      status: 'ready',
      total_count: data.total,
      valid_count: data.valid_count,
      failed_count: 0,
      applied_count: 0,
    })
    .select('id')
    .single()

  if (batchError || !batch) return { ok: false, status: 500, error: 'Error al guardar el lote.' }

  if (data.items.length > 0) {
    const { error: itemsError } = await db.from('catalog_bulk_batch_items').insert(
      data.items.map((item) => ({
        batch_id: batch.id,
        product_id: item.id,
        title: item.title,
        before: item.before,
        after: item.after,
        patch: item.patch,
        valid: item.valid,
        error_message: item.error,
        status: 'pending',
      })),
    )
    if (itemsError) return { ok: false, status: 500, error: 'Error al guardar los productos del lote.' }
  }

  return { ok: true, batch_id: batch.id, total: data.total, valid_count: data.valid_count, invalid_count: data.invalid_count }
}

export interface StoredBatch {
  id: string
  seller_id: string
  action: BulkActionPayload
  status: string
  total_count: number
  valid_count: number
  applied_count: number
  failed_count: number
  created_at: string
}

export interface StoredBatchItem {
  id: string
  product_id: string
  title: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  patch: Record<string, unknown> | null
  valid: boolean
  error_message: string | null
  status: 'pending' | 'applied' | 'failed'
}

/** Read a batch back (survives refresh — the Shopify failure mode). Returns
 * null if the batch doesn't exist OR belongs to a different seller (ownership
 * check, not just existence). */
export async function getBulkBatch(
  batchId: string,
  userId: string,
): Promise<{ batch: StoredBatch; items: StoredBatchItem[] } | null> {
  const { data: batch } = await db.from('catalog_bulk_batches').select('*').eq('id', batchId).maybeSingle()
  if (!batch || batch.seller_id !== userId) return null

  const { data: items } = await db
    .from('catalog_bulk_batch_items')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })

  return { batch: batch as StoredBatch, items: (items ?? []) as StoredBatchItem[] }
}

export type ApplyResult =
  | { ok: true; applied: number; failed: number; skipped: number }
  | { ok: false; status: number; error: string }

/**
 * Apply a staged batch. Idempotent: an item already `applied` is skipped
 * (reported, not re-executed) rather than re-sent. Routes `pause_activate`
 * batches through `setListingStatus()` per item (the frontend orchestration
 * — ML close, viability gate, Supabase mirror); every other action type goes
 * through ONE call to the backend's `bulk-apply` batch endpoint.
 */
export async function applyBulkBatch(
  batchId: string,
  ctx: { userId: string; clerkJwt: string },
): Promise<ApplyResult> {
  const found = await getBulkBatch(batchId, ctx.userId)
  if (!found) return { ok: false, status: 404, error: 'Lote no encontrado.' }
  const { batch, items } = found

  const pending = items.filter((i) => i.status === 'pending' && i.valid)
  const skipped = items.filter((i) => i.status !== 'pending').length

  if (pending.length === 0) {
    return { ok: true, applied: 0, failed: 0, skipped: items.length }
  }

  await db.from('catalog_bulk_batches').update({ status: 'applying', updated_at: new Date().toISOString() }).eq('id', batchId)

  let applied = 0
  let failed = 0

  const actionType = batch.action.type

  if (batch.action.type === 'pause_activate') {
    const target = batch.action.status
    const { setListingStatus } = await import('@/lib/listing-status')
    for (const item of pending) {
      const result = await setListingStatus(item.product_id, target, { userId: ctx.userId, clerkJwt: ctx.clerkJwt })
      await recordItemResult(batchId, item, result.ok, ctx.userId, actionType, result.ok ? undefined : result.error)
      if (result.ok) applied++
      else failed++
    }
  } else {
    const res = await medusaFetch('/store/sellers/me/products/bulk-apply', ctx.clerkJwt, {
      method: 'POST',
      body: JSON.stringify({ items: pending.map((i) => ({ id: i.product_id, patch: i.patch })) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      await db.from('catalog_bulk_batches').update({ status: 'partially_failed', updated_at: new Date().toISOString() }).eq('id', batchId)
      return { ok: false, status: res.status, error: body.message ?? 'Error al aplicar el lote.' }
    }
    const { results } = await res.json() as { results: Array<{ id: string; ok: boolean; error?: string }> }
    const byId = new Map(results.map((r) => [r.id, r]))
    for (const item of pending) {
      const r = byId.get(item.product_id)
      const ok = r?.ok ?? false
      await recordItemResult(batchId, item, ok, ctx.userId, actionType, ok ? undefined : (r?.error ?? 'Error desconocido.'))
      if (ok) applied++
      else failed++
    }
  }

  await db
    .from('catalog_bulk_batches')
    .update({
      status: failed > 0 ? 'partially_failed' : 'applied',
      applied_count: applied,
      failed_count: failed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  return { ok: true, applied, failed, skipped }
}

async function recordItemResult(
  batchId: string,
  item: StoredBatchItem,
  ok: boolean,
  actorId: string,
  actionType: string,
  error?: string,
): Promise<void> {
  await db
    .from('catalog_bulk_batch_items')
    .update({ status: ok ? 'applied' : 'failed', error_message: ok ? null : (error ?? null) })
    .eq('id', item.id)

  await db.from('catalog_bulk_audit_log').insert({
    batch_id: batchId,
    item_id: item.id,
    product_id: item.product_id,
    actor_type: 'seller',
    actor_id: actorId,
    action: actionType,
    before: item.before,
    after: item.after,
    result: ok ? 'applied' : 'failed',
    error_message: ok ? null : (error ?? null),
  })
}
