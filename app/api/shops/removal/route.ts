import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { normalizedClaimEmail } from '@/lib/claim-invitation'
import { readSellerStatus, changeSellerStatus } from '@/lib/admin/tenant-status'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { revalidateTag } from 'next/cache'
import { sendGrowthEvent } from '@/lib/growth-engine'
import { verifyClaimToken } from '@/lib/claimJwt'
import { tg } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin || origin !== req.nextUrl.origin) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 403 })
  const limit = await checkRateLimit('shop_removal', getClientIp(req))
  if (!limit.allowed) return NextResponse.json({ error: 'Intenta de nuevo más tarde.' }, { status: 429 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 }) }
  const rawToken = typeof body.token === 'string' && body.token.length <= 4000 ? body.token : ''
  let invitation
  try { invitation = await verifyClaimToken(rawToken) } catch {
    return NextResponse.json({ error: 'El enlace no es válido o venció.' }, { status: 400 })
  }
  if (invitation.purpose !== 'removal' || typeof invitation.shopId !== 'string' || !invitation.shopId.startsWith('sel_') ||
      (invitation.market !== 'mx' && invitation.market !== 'us')) {
    return NextResponse.json({ error: 'El enlace no corresponde a una solicitud de retiro.' }, { status: 400 })
  }
  const slug = invitation.shopSlug
  const requestedMarket = invitation.market
  const email = normalizedClaimEmail(body.email)
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const campaignId = typeof invitation.campaignId === 'string' && /^[a-z0-9-]{1,80}$/.test(invitation.campaignId) ? invitation.campaignId : null
  if (!slug || slug.length > 150 || !email || reason.length < 10 || reason.length > 2000) {
    return NextResponse.json({ error: 'Revisa el correo y explica brevemente tu solicitud.' }, { status: 400 })
  }
  const shopRead = await readShopFresh(slug, requestedMarket)
  if (shopRead.state === 'unavailable') return NextResponse.json({ error: 'No pudimos comprobar la tienda. Intenta más tarde.' }, { status: 503 })
  if (shopRead.state === 'absent') return NextResponse.json({ error: 'No encontramos una tienda pública sin reclamar con ese enlace.' }, { status: 404 })
  const shop = shopRead.shop
  if (shop.id !== invitation.shopId || shop.clerk_user_id) return NextResponse.json({ error: 'No encontramos una tienda pública sin reclamar con ese enlace.' }, { status: 404 })
  const market = readPublicSellerMarket(shop)?.market_code
  if (!market || market !== requestedMarket) return NextResponse.json({ error: 'El mercado de la tienda no coincide.' }, { status: 400 })
  const status = await readSellerStatus(shop.id)
  if (status.state !== 'resolved') return NextResponse.json({ error: 'No pudimos comprobar la tienda. Intenta más tarde.' }, { status: 503 })
  if (status.status !== 'active') return NextResponse.json({ error: 'Esta tienda ya está fuera de línea.' }, { status: 409 })

  const { data: mirror, error: mirrorError } = await db.from('marketplace_shops')
    .select('id').contains('metadata', { medusa_seller_id: shop.id }).maybeSingle()
  if (mirrorError || !mirror) return NextResponse.json({ error: 'No pudimos registrar la solicitud.' }, { status: 503 })
  const { data: record, error } = await db.from('shop_removal_requests').insert({
    shop_id: mirror.id, requested_email: email, reason, market_code: market,
  }).select('id').single()
  if (error || !record) return NextResponse.json({ error: 'No pudimos registrar la solicitud.' }, { status: 503 })
  await tg.alert(`Solicitud de retiro ${record.id} para ${shop.slug}. Revisar /api/admin/removal-requests.`)
  if (invitation.invitationId) {
    const { error: conversionError } = await db.from('claim_campaign_invitations')
      .update({ removal_requested_at: new Date().toISOString() })
      .eq('id', invitation.invitationId).eq('seller_id', shop.id)
    if (conversionError) console.error('[shop removal] invitation update failed', conversionError)
  }

  const change = await changeSellerStatus({
    medusaSellerId: shop.id, status: 'paused', reason: `Public removal request ${record.id}`,
  })
  if (change.ok === true) {
    const { error: updateError } = await db.from('shop_removal_requests')
      .update({ state: 'paused', paused_at: new Date().toISOString() }).eq('id', record.id)
    if (updateError) console.error('[shop removal] status receipt update failed', updateError)
    // A takedown may not serve the previous cached shop once while refreshing.
    revalidateTag('shops', { expire: 0 })
    revalidateTag('listings', { expire: 0 })
    if (campaignId) await sendGrowthEvent({ userId: shop.id, event: 'campaign.removal_requested',
      featureId: 'claim-shop-acquisition', tags: { campaign_id: campaignId, market } })
    return NextResponse.json({ ok: true, requestId: record.id, offline: true })
  }
  if (change.ok === 'unknown') {
    await db.from('shop_removal_requests').update({ state: 'status_unknown' }).eq('id', record.id)
    return NextResponse.json({ error: 'Recibimos la solicitud, pero no pudimos confirmar si la tienda quedó fuera de línea. Te responderemos por correo.', requestId: record.id }, { status: 504 })
  }
  return NextResponse.json({ error: 'Recibimos la solicitud, pero no pudimos poner la tienda fuera de línea. Te responderemos por correo.', requestId: record.id }, { status: 503 })
}
