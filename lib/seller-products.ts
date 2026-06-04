/**
 * Frontend bridge for agent-driven listing management (Seller Agent Operations
 * · Sprint 2). Reads listings from the Supabase mirror (all statuses, scoped by
 * shop) and writes through the backend internal route (which an agent token
 * can't reach directly — it's the service-to-service path holding the shared
 * secret). The backend re-verifies ownership by seller slug; we also verify here
 * against the mirror (defense in depth).
 */

import { db } from './supabase'
import { formatOfferAmount } from './offers'
import { getShopStripe } from './stripe'
import { sellerHasMpConnected } from './mercadopago-connect'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export interface AgentListingView {
  product_id: string
  title: string
  price: string | null
  status: string
  listing_type: string
}

/** List a shop's listings (all non-deleted statuses) from the mirror. */
export async function listShopListings(shopId: string): Promise<AgentListingView[]> {
  const { data } = await db
    .from('marketplace_listings')
    .select('medusa_product_id, title, price_cents, currency, status, listing_type')
    .eq('shop_id', shopId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(100)

  return (data ?? [])
    .filter((r) => r.medusa_product_id)
    .map((r) => ({
      product_id: r.medusa_product_id as string,
      title: r.title as string,
      price: r.price_cents != null ? formatOfferAmount(r.price_cents as number, (r.currency as string) ?? 'MXN') : null,
      status: r.status as string,
      listing_type: r.listing_type as string,
    }))
}

/** Confirm a product belongs to this shop (via the mirror). Returns its type, or null. */
export async function shopOwnsProduct(shopId: string, productId: string): Promise<{ listing_type: string } | null> {
  const { data } = await db
    .from('marketplace_listings')
    .select('listing_type')
    .eq('shop_id', shopId)
    .eq('medusa_product_id', productId)
    .maybeSingle()
  return data ? { listing_type: data.listing_type as string } : null
}

export interface SellerProductPatch {
  title?: string
  description?: string | null
  price_cents?: number | null
  quantity?: number | null
  status?: 'published' | 'draft'
}

/** PATCH the product through the backend internal route (x-internal-secret). */
export async function patchSellerProductViaInternal(
  sellerSlug: string,
  productId: string,
  body: SellerProductPatch,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!INTERNAL_SECRET) return { ok: false, status: 500, error: 'Internal secret not configured.' }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/seller-products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ seller_slug: sellerSlug, ...body }),
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: false, status: res.status, error: d.message ?? `Error ${res.status}` }
    }
    return { ok: true, status: 200 }
  } catch (e) {
    return { ok: false, status: 500, error: String(e) }
  }
}

function normalizeClabe(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : ''
}

/**
 * Returns a plain-language reason a product listing can't be activated, or null
 * if it's OK. Mirrors the portal's checkCheckoutViability rule (a physical
 * product needs BOTH a concrete delivery method AND a concrete payment method)
 * but evaluates against the shop metadata we already hold — no Medusa fetch.
 */
export function listingActivationBlock(shopMeta: Record<string, unknown> | null, listingType: string): string | null {
  if (listingType !== 'product') return null
  const meta = shopMeta ?? {}
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const shipping = (settings.shipping ?? {}) as Record<string, unknown>
  const checkout = (settings.checkout ?? {}) as Record<string, unknown>

  const hasLiveShipping = shipping.envia_enabled !== false && (() => {
    const oa = (shipping.origin_address ?? {}) as Record<string, string | null>
    return !!(oa.street && oa.city && oa.postal_code && (oa.state_code || oa.state))
  })()
  const hasDelivery = hasLiveShipping || !!shipping.local_pickup

  const stripe = getShopStripe(meta)
  const hasStripe = !!(stripe.charges_enabled && stripe.account_id && stripe.enabled !== false)
  const hasMp = sellerHasMpConnected(meta)
  const bankTransfer = (checkout.bank_transfer ?? {}) as Record<string, unknown>
  const hasSpei = bankTransfer.enabled !== false && normalizeClabe(bankTransfer.clabe).length === 18
  const dimo = (checkout.dimo ?? {}) as Record<string, unknown>
  const hasDimo = dimo.enabled === true && normalizeClabe(dimo.phone).length >= 10
  const hasPayment = hasStripe || hasMp || hasSpei || hasDimo

  if (hasDelivery && hasPayment) return null
  const missing: string[] = []
  if (!hasDelivery) missing.push('una forma de entrega (envío o recolección)')
  if (!hasPayment) missing.push('un método de pago (MercadoPago, Stripe, SPEI o DiMo)')
  return `Para activar este anuncio configura ${missing.join(' y ')} en Mi tienda → Configuración.`
}
