import { NextRequest } from 'next/server'
import { db } from '@/lib/supabase'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { normalizedClaimEmail } from '@/lib/claim-invitation'
import { sendClaimRequestReceived } from '@/lib/email'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { tg } from '@/lib/telegram'

/** Public interest is a review request, never proof of business ownership. */
export async function POST(req: NextRequest) {
  const limit = await checkRateLimit('claim_request', getClientIp(req))
  if (!limit.allowed) return Response.json({ error: 'Intenta de nuevo más tarde.' }, { status: 429 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'Solicitud inválida.' }, { status: 400 }) }
  const email = normalizedClaimEmail(body.email)
  const slug = typeof body.shopSlug === 'string' ? body.shopSlug : ''
  const market = body.market === 'mx' || body.market === 'us' ? body.market : undefined
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : ''
  if (!email || !slug || slug.length > 150) return Response.json({ error: 'Correo o tienda inválidos.' }, { status: 400 })

  const shopRead = await readShopFresh(slug, market)
  if (shopRead.state === 'unavailable') return Response.json({ error: 'No pudimos comprobar la tienda. Intenta más tarde.' }, { status: 503 })
  if (shopRead.state === 'absent') return Response.json({ error: 'Esta tienda no está disponible para reclamar.' }, { status: 409 })
  const shop = shopRead.shop
  if (shop.clerk_user_id || shop.id !== body.shopId || (market && readPublicSellerMarket(shop)?.market_code !== market)) {
    return Response.json({ error: 'Esta tienda no está disponible para reclamar.' }, { status: 409 })
  }
  const { data: mirror, error: mirrorError } = await db.from('marketplace_shops')
    .select('id').contains('metadata', { medusa_seller_id: shop.id }).maybeSingle()
  if (mirrorError || !mirror) {
    console.error('[claim/send] mirror unavailable', mirrorError)
    return Response.json({ error: 'No pudimos registrar la solicitud. Intenta más tarde.' }, { status: 503 })
  }
  const { error } = await db.from('marketplace_claims').upsert({
    shop_id: mirror.id,
    clerk_user_id: `pending:${email}`,
    status: 'pending',
    message: message || null,
  }, { onConflict: 'shop_id,clerk_user_id' })
  if (error) {
    console.error('[claim/send] insert failed', error)
    return Response.json({ error: 'No pudimos registrar la solicitud. Intenta más tarde.' }, { status: 503 })
  }
  const receipt = await sendClaimRequestReceived({ to: email, shopName: shop.name, market: market ?? 'mx' })
  await tg.alert(`Solicitud de acceso pendiente: ${shop.slug}. Revisar /api/admin/claim-invitations.`)
  return Response.json({ ok: true, emailSent: receipt.ok })
}
