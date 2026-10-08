import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { readShopFresh } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { readSellerStatus } from '@/lib/admin/tenant-status'
import { buildClaimLandingUrl } from '@/lib/claim-invitation'
import { signClaimToken } from '@/lib/claimJwt'
import { isShopPreviewPrivateForShop } from '@/lib/preview-access'
import { claimLinkPreviewUrl } from '@/lib/admin/claim-link-directory'
import { prepareClaimLinkBatch, type ClaimLinkShopInput } from '@/lib/admin/claim-link-bulk'
import { publicClaimLinkEmail } from '@/lib/admin/claim-link-public-emails'

type ShopInput = ClaimLinkShopInput
type PreparedLinks = { shopSlug: string; market: 'mx' | 'us'; shopName: string; email: string; previewUrl: string | null; claimUrl: string }
class ClaimLinkError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function parseShop(input: unknown): ShopInput | null {
  if (!input || typeof input !== 'object') return null
  const item = input as Record<string, unknown>
  const shopSlug = typeof item.shopSlug === 'string' ? item.shopSlug.trim() : ''
  const market = item.market === 'mx' || item.market === 'us' ? item.market : null
  return shopSlug && shopSlug.length <= 150 && market ? { shopSlug, market } : null
}

async function prepareLinks({ shopSlug, market }: ShopInput): Promise<PreparedLinks> {
  const read = await readShopFresh(shopSlug, market)
  if (read.state === 'unavailable') throw new ClaimLinkError('No pudimos comprobar la tienda.', 503)
  if (read.state === 'absent') throw new ClaimLinkError('Tienda no encontrada.', 404)
  const shop = read.shop
  if (shop.clerk_user_id || readPublicSellerMarket(shop)?.market_code !== market) {
    throw new ClaimLinkError('La tienda no está disponible para reclamar.', 409)
  }
  const status = await readSellerStatus(shop.id)
  if (status.state !== 'resolved') throw new ClaimLinkError('No pudimos comprobar el estado de la tienda.', 503)
  if (status.status !== 'active') throw new ClaimLinkError('La tienda no está activa.', 409)
  if (!process.env.CLAIM_JWT_SECRET) throw new ClaimLinkError('Firma de enlaces no configurada.', 503)

  const token = await signClaimToken({
    shopId: shop.id, shopSlug: shop.slug, shopName: shop.name, market, purpose: 'campaign',
  }, null)
  // A held preview or an unreadable privacy check must not become a broken public URL.
  let previewAvailable = false
  try { previewAvailable = !(await isShopPreviewPrivateForShop(shop)) } catch { /* fail closed */ }
  const merchantEmail = shop.metadata?.merchant_email
  const email = typeof merchantEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchantEmail.trim())
    ? merchantEmail.trim() : publicClaimLinkEmail(shop.id)
  return {
    shopSlug, market, shopName: shop.name, email,
    previewUrl: claimLinkPreviewUrl(market, shop.slug, previewAvailable, 'https://miyagisanchez.com'),
    claimUrl: buildClaimLandingUrl(token),
  }
}

/** Prepare shop-specific links for a personally written invitation; send nothing. */
export const POST = withAdmin<NextRequest>(async (req) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  if (Array.isArray(body.shops)) {
    if (body.shops.length === 0 || body.shops.length > 500) {
      return NextResponse.json({ error: 'Selecciona entre 1 y 500 tiendas.' }, { status: 400 })
    }
    const shops = body.shops.map(parseShop)
    if (shops.some((shop) => !shop)) return NextResponse.json({ error: 'Selección de tiendas inválida.' }, { status: 400 })
    const valid = shops as ShopInput[]
    const keys = valid.map((shop) => `${shop.market}:${shop.shopSlug}`)
    if (new Set(keys).size !== keys.length) return NextResponse.json({ error: 'Hay tiendas repetidas.' }, { status: 400 })
    const batch = await prepareClaimLinkBatch(valid, prepareLinks,
      (error) => error instanceof ClaimLinkError ? error.message : 'No pudimos preparar los enlaces.')
    return NextResponse.json(batch)
  }
  const shop = parseShop(body)
  if (!shop) return NextResponse.json({ error: 'Elige una tienda y un mercado.' }, { status: 400 })
  try { return NextResponse.json(await prepareLinks(shop)) }
  catch (error) {
    return NextResponse.json({ error: error instanceof ClaimLinkError ? error.message : 'No pudimos preparar los enlaces.' },
      { status: error instanceof ClaimLinkError ? error.status : 503 })
  }
})
