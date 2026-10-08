import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { readSellerStatus } from '@/lib/admin/tenant-status'
import { buildClaimLandingUrl } from '@/lib/claim-invitation'
import { signClaimToken } from '@/lib/claimJwt'
import { isShopPreviewPrivateForShop } from '@/lib/preview-access'
import { claimLinkPreviewUrl } from '@/lib/admin/claim-link-directory'

/** Prepare shop-specific links for a personally written invitation; send nothing. */
export const POST = withAdmin<NextRequest>(async (req) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  const slug = typeof body.shopSlug === 'string' ? body.shopSlug.trim() : ''
  const market = body.market === 'mx' || body.market === 'us' ? body.market : null
  if (!slug || slug.length > 150 || !market) return NextResponse.json({ error: 'Elige una tienda y un mercado.' }, { status: 400 })

  const read = await readShopFresh(slug, market)
  if (read.state === 'unavailable') return NextResponse.json({ error: 'No pudimos comprobar la tienda.' }, { status: 503 })
  if (read.state === 'absent') return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  const shop = read.shop
  if (shop.clerk_user_id || readPublicSellerMarket(shop)?.market_code !== market) {
    return NextResponse.json({ error: 'La tienda no está disponible para reclamar.' }, { status: 409 })
  }
  const status = await readSellerStatus(shop.id)
  if (status.state !== 'resolved') return NextResponse.json({ error: 'No pudimos comprobar el estado de la tienda.' }, { status: 503 })
  if (status.status !== 'active') return NextResponse.json({ error: 'La tienda no está activa.' }, { status: 409 })
  if (!process.env.CLAIM_JWT_SECRET) return NextResponse.json({ error: 'Firma de enlaces no configurada.' }, { status: 503 })

  const token = await signClaimToken({
    shopId: shop.id, shopSlug: shop.slug, shopName: shop.name, market, purpose: 'campaign',
  }, null)
  // A held merchant preview (or an unreadable privacy check) makes /s/[slug]
  // return 404. Keep the claim link usable, but never offer a broken public view.
  let previewAvailable = false
  try { previewAvailable = !(await isShopPreviewPrivateForShop(shop)) } catch { /* fail closed */ }
  return NextResponse.json({
    shopName: shop.name,
    previewUrl: claimLinkPreviewUrl(market, shop.slug, previewAvailable, 'https://miyagisanchez.com'),
    claimUrl: buildClaimLandingUrl(token),
  })
})
