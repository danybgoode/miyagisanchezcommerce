import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { readSellerStatus } from '@/lib/admin/tenant-status'
import { normalizedClaimEmail, buildClaimLandingUrl, buildRemovalLandingUrl } from '@/lib/claim-invitation'
import { signClaimToken } from '@/lib/claimJwt'
import { db } from '@/lib/supabase'

/** Pending public requests are visible to an operator for actual vetting. */
export const GET = withAdmin(async () => {
  const { data, error } = await db.from('marketplace_claims')
    .select('shop_id, clerk_user_id, status, message').eq('status', 'pending').limit(100)
  if (error) return NextResponse.json({ error: 'No pudimos leer las solicitudes.' }, { status: 503 })
  return NextResponse.json({ requests: data })
})

/** Operator-reviewed link minting. This route never sends a campaign email. */
export const POST = withAdmin<NextRequest>(async (req) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  const slug = typeof body.shopSlug === 'string' ? body.shopSlug.trim() : ''
  const requestedMarket = body.market === 'mx' || body.market === 'us' ? body.market : null
  const email = normalizedClaimEmail(body.email)
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : ''
  const provenance = typeof body.contactProvenance === 'string' ? body.contactProvenance.trim() : ''
  if (!slug || slug.length > 150 || !requestedMarket || !email || !/^[a-z0-9-]{1,80}$/.test(campaignId) || !provenance || provenance.length > 500) {
    return NextResponse.json({ error: 'Faltan tienda, correo, campaña o procedencia del contacto.' }, { status: 400 })
  }
  const shopRead = await readShopFresh(slug, requestedMarket)
  if (shopRead.state === 'unavailable') return NextResponse.json({ error: 'No pudimos comprobar la tienda.' }, { status: 503 })
  if (shopRead.state === 'absent') return NextResponse.json({ error: 'La tienda no está disponible para reclamar.' }, { status: 409 })
  const shop = shopRead.shop
  if (!shop.verified || shop.clerk_user_id) return NextResponse.json({ error: 'La tienda no está pública o ya fue reclamada.' }, { status: 409 })
  const market = readPublicSellerMarket(shop)?.market_code
  if (!market || market !== requestedMarket) return NextResponse.json({ error: 'No pudimos verificar el mercado de la tienda.' }, { status: 503 })
  const status = await readSellerStatus(shop.id)
  if (status.state !== 'resolved') return NextResponse.json({ error: 'No pudimos verificar el estado de la tienda.' }, { status: 503 })
  if (status.status !== 'active') return NextResponse.json({ error: 'La tienda no está pública.' }, { status: 409 })
  if (!process.env.CLAIM_JWT_SECRET) return NextResponse.json({ error: 'Firma de invitaciones no configurada.' }, { status: 503 })

  const invitationId = crypto.randomUUID()
  const token = await signClaimToken({
    shopId: shop.id, shopSlug: shop.slug, shopName: shop.name,
    market, campaignId, invitationId, purpose: 'campaign',
  }, null)
  const removalToken = await signClaimToken({
    shopId: shop.id, shopSlug: shop.slug, shopName: shop.name,
    market, campaignId, invitationId, purpose: 'removal',
  }, null)
  const { error } = await db.from('claim_campaign_invitations').insert({
    id: invitationId, seller_id: shop.id, shop_slug: shop.slug,
    contact_email: email, contact_provenance: provenance,
    market_code: market, campaign_id: campaignId, expires_at: null,
  })
  if (error) return NextResponse.json({ error: 'No pudimos registrar la invitación.' }, { status: 503 })
  return NextResponse.json({ claimUrl: buildClaimLandingUrl(token), removalUrl: buildRemovalLandingUrl(removalToken), expiresAt: null, invitationId })
})
