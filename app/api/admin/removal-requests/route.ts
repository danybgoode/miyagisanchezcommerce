import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { medusaSellerIdOf } from '@/lib/admin/tenant-directory'
import { readSellerStatus, changeSellerStatus } from '@/lib/admin/tenant-status'
import { revalidateTag } from 'next/cache'

/** Operator queue and final disposition; no permanent deletion before verification. */
export const GET = withAdmin(async () => {
  const { data, error } = await db.from('shop_removal_requests')
    .select('id, shop_id, requested_email, reason, market_code, state, created_at, paused_at, verification_note, verified_at, resolved_at')
    .order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: 'No pudimos leer las solicitudes.' }, { status: 503 })
  return NextResponse.json({ requests: data })
})

export const PATCH = withAdmin<NextRequest>(async (req) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  const id = typeof body.id === 'string' ? body.id : ''
  const action = body.action
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['retry_pause', 'verify', 'reject', 'remove'].includes(String(action))) {
    return NextResponse.json({ error: 'Solicitud o acción inválida.' }, { status: 400 })
  }
  const { data: request, error } = await db.from('shop_removal_requests')
    .select('id, shop_id, state').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'No pudimos leer la solicitud.' }, { status: 503 })
  if (!request) return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 })
  const state = request.state as string
  if (action === 'retry_pause') {
    if (state !== 'received' && state !== 'status_unknown') {
      return NextResponse.json({ error: 'Esta solicitud no necesita otro intento de pausa.' }, { status: 409 })
    }
    const { data: shop, error: shopError } = await db.from('marketplace_shops')
      .select('metadata').eq('id', request.shop_id).maybeSingle()
    const sellerId = medusaSellerIdOf(shop?.metadata)
    if (shopError || !sellerId) return NextResponse.json({ error: 'No pudimos resolver la tienda de Medusa.' }, { status: 503 })
    const current = await readSellerStatus(sellerId)
    if (current.state !== 'resolved') return NextResponse.json({ error: 'No pudimos comprobar el estado de la tienda.' }, { status: 503 })
    if (current.status === 'active') {
      const pause = await changeSellerStatus({ medusaSellerId: sellerId, status: 'paused', reason: `Removal request ${id}: retry pause` })
      if (pause.ok === 'unknown') return NextResponse.json({ error: pause.message, applied: 'unknown' }, { status: 504 })
      if (!pause.ok) return NextResponse.json({ error: pause.message }, { status: pause.status })
    } else if (current.status !== 'paused') {
      return NextResponse.json({ error: 'La tienda no puede pausarse desde su estado actual.' }, { status: 409 })
    }
    const { error: updateError } = await db.from('shop_removal_requests')
      .update({ state: 'paused', paused_at: new Date().toISOString() }).eq('id', id)
    if (updateError) return NextResponse.json({ error: 'La tienda está pausada, pero el registro necesita revisión.', applied: 'unknown' }, { status: 504 })
    revalidateTag('shops', { expire: 0 })
    revalidateTag('listings', { expire: 0 })
    return NextResponse.json({ ok: true, state: 'paused' })
  }
  if (action === 'verify') {
    if (state !== 'paused') return NextResponse.json({ error: 'Primero confirma que la tienda esté fuera de línea.' }, { status: 409 })
    const note = typeof body.verificationNote === 'string' ? body.verificationNote.trim() : ''
    if (note.length < 10 || note.length > 2000) return NextResponse.json({ error: 'Explica cómo verificaste a la persona.' }, { status: 400 })
    const result = await db.from('shop_removal_requests')
      .update({ state: 'verified', verification_note: note, verified_at: new Date().toISOString() })
      .eq('id', id).eq('state', 'paused').select('id').maybeSingle()
    if (result.error) return NextResponse.json({ error: 'No pudimos guardar la verificación.' }, { status: 503 })
    if (!result.data) return NextResponse.json({ error: 'La solicitud cambió mientras la revisabas.' }, { status: 409 })
    return NextResponse.json({ ok: true, state: 'verified' })
  }

  if (action === 'remove' && state !== 'verified') {
    return NextResponse.json({ error: 'Verifica a la persona antes de eliminar la tienda.' }, { status: 409 })
  }
  if (action === 'reject' && state !== 'paused') {
    return NextResponse.json({ error: 'Solo puede restaurarse una solicitud pausada.' }, { status: 409 })
  }
  const { data: shop, error: shopError } = await db.from('marketplace_shops')
    .select('metadata').eq('id', request.shop_id).maybeSingle()
  const sellerId = medusaSellerIdOf(shop?.metadata)
  if (shopError || !sellerId) return NextResponse.json({ error: 'No pudimos resolver la tienda de Medusa.' }, { status: 503 })
  const current = await readSellerStatus(sellerId)
  if (current.state !== 'resolved') return NextResponse.json({ error: 'No pudimos comprobar el estado de la tienda.' }, { status: 503 })
  if (current.status !== 'paused') return NextResponse.json({ error: 'La tienda ya no está pausada; revisa su estado antes de continuar.' }, { status: 409 })
  const result = await changeSellerStatus({
    medusaSellerId: sellerId,
    status: action === 'remove' ? 'deleted' : 'active',
    reason: `Removal request ${id}: ${action}`,
  })
  if (result.ok === 'unknown') return NextResponse.json({ error: result.message, applied: 'unknown' }, { status: 504 })
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  const nextState = action === 'remove' ? 'removed' : 'rejected'
  const { error: updateError } = await db.from('shop_removal_requests')
    .update({ state: nextState, resolved_at: new Date().toISOString() }).eq('id', id)
  if (updateError) return NextResponse.json({ error: 'Medusa cambió el estado, pero no pudimos cerrar la solicitud. Verifica el registro antes de reintentar.', applied: 'unknown' }, { status: 504 })
  revalidateTag('shops', { expire: 0 })
  revalidateTag('listings', { expire: 0 })
  return NextResponse.json({ ok: true, state: nextState })
})
