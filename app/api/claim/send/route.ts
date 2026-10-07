import { NextRequest } from 'next/server'
import { signClaimToken } from '@/lib/claimJwt'
import { buildClaimLandingUrl, canIssuePublicClaimLink, normalizedClaimEmail } from '@/lib/claim-invitation'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { sendShopClaimLink } from '@/lib/email'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'

/** Anyone may request a shop-specific link to an inbox they control. */
export async function POST(req: NextRequest) {
  const limit = await checkRateLimit('claim_request', getClientIp(req))
  if (!limit.allowed) return Response.json({ error: 'Intenta de nuevo más tarde.' }, { status: 429 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'Solicitud inválida.' }, { status: 400 }) }
  const email = normalizedClaimEmail(body.email)
  const slug = typeof body.shopSlug === 'string' ? body.shopSlug.trim() : ''
  const requestedMarket = body.market === 'mx' || body.market === 'us' ? body.market : undefined
  if (!email || !slug || slug.length > 150 || typeof body.shopId !== 'string') {
    return Response.json({ error: 'Correo o tienda inválidos.' }, { status: 400 })
  }

  const shopRead = await readShopFresh(slug, requestedMarket)
  if (shopRead.state === 'unavailable') return Response.json({ error: 'No pudimos comprobar la tienda. Intenta más tarde.' }, { status: 503 })
  if (shopRead.state === 'absent') return Response.json({ error: 'Esta tienda no está disponible para reclamar.' }, { status: 409 })
  const shop = shopRead.shop
  const market = readPublicSellerMarket(shop)?.market_code
  if (!market) return Response.json({ error: 'No pudimos comprobar el mercado de la tienda.' }, { status: 503 })
  // Never sign the client-supplied name/id: stale tabs and crafted requests can
  // otherwise send a valid claim for a different shop than the page displayed.
  if (!canIssuePublicClaimLink(
    { shopId: body.shopId, shopSlug: slug, market: requestedMarket },
    { id: shop.id, slug: shop.slug, verified: shop.verified, clerkUserId: shop.clerk_user_id, market: market ?? null },
  )) {
    return Response.json({ error: 'Esta tienda no está disponible para reclamar.' }, { status: 409 })
  }
  if (!process.env.CLAIM_JWT_SECRET) return Response.json({ error: 'Enlaces de reclamación no disponibles.' }, { status: 503 })

  const token = await signClaimToken({ shopId: shop.id, shopSlug: shop.slug, shopName: shop.name, market, purpose: 'public' })
  const result = await sendShopClaimLink({ to: email, shopName: shop.name, claimUrl: buildClaimLandingUrl(token), market })
  if (!result.ok) {
    console.error('[claim/send] claim email delivery failed', result.reason)
    return Response.json({ error: 'No pudimos enviar el enlace. Intenta de nuevo.' }, { status: 503 })
  }
  return Response.json({ ok: true, sent: true })
}
