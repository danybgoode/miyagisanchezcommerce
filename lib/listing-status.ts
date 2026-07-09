/**
 * Shared listing status-change orchestration — extracted from
 * `app/api/sell/listing/[id]/route.ts` PATCH (catalog-management epic,
 * Sprint 3 · Story 3.1) so the new bulk-apply path can pause/activate a
 * product WITHOUT bypassing the side effects that live here: the Sprint 1.3
 * `metadata.paused` fix (Medusa's native status alone can't tell "paused"
 * apart from "never-published draft"), the activation checkout-viability
 * gate, the Supabase `marketplace_listings` mirror, the pause → ML-close
 * cascade, and the launchpad first-publish notify. A bulk action that only
 * sent `{status}` straight to the backend would silently reintroduce the
 * pausado/borrador regression for every bulk-paused product — see the
 * Sprint 3 plan's "mid-build correction" note.
 *
 * server-only (calls Medusa with the caller's Clerk JWT).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import { getShopStripe } from '@/lib/stripe'
import { isEnabled } from '@/lib/flags'
import { closeMlProduct } from '@/lib/ml-publish-bridge'
import { notifyWriterOnPublish } from '@/lib/launchpad'

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

async function getShopSlug(userId: string): Promise<string | null> {
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return shop?.slug ?? null
}

async function bestEffortCloseMl(userId: string, productId: string): Promise<void> {
  try {
    if (!(await isEnabled('ml.publish_enabled'))) return
    const slug = await getShopSlug(userId)
    if (slug) await closeMlProduct(slug, productId)
  } catch {
    /* never block the archive on a ML failure */
  }
}

function normalizeClabe(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : ''
}

async function checkCheckoutViability(listingId: string, clerkJwt: string): Promise<string | null> {
  try {
    const [listingRes, sellerRes] = await Promise.all([
      medusaFetch(`/store/listings/${listingId}`, clerkJwt),
      medusaFetch('/store/sellers/me', clerkJwt),
    ])
    if (!listingRes.ok || !sellerRes.ok) return null // non-fatal — allow publish on error

    const { listing } = await listingRes.json() as { listing: Record<string, unknown> }
    const { seller } = await sellerRes.json() as { seller: Record<string, unknown> }

    const listingType = (listing?.metadata as Record<string, unknown> | null)?.listing_type as string ?? 'product'
    if (listingType !== 'product') return null

    const shopMeta = (seller?.metadata ?? {}) as Record<string, unknown>
    const settings = (shopMeta.settings ?? {}) as Record<string, unknown>
    const shipping = (settings.shipping ?? {}) as Record<string, unknown>
    const checkout = (settings.checkout ?? {}) as Record<string, unknown>

    const hasLiveShipping = shipping.envia_enabled !== false && (() => {
      const oa = (shipping.origin_address ?? {}) as Record<string, string | null>
      return !!(oa.street && oa.city && oa.postal_code && (oa.state_code || oa.state))
    })()
    const hasLocalPickup = !!shipping.local_pickup
    const hasDelivery = hasLiveShipping || hasLocalPickup

    const stripe = getShopStripe(shopMeta)
    const hasStripe = !!(stripe.charges_enabled && stripe.account_id && stripe.enabled !== false)
    const hasMp = sellerHasMpConnected(shopMeta)
    const bankTransfer = (checkout.bank_transfer ?? {}) as Record<string, unknown>
    const hasSpei = bankTransfer.enabled !== false && normalizeClabe(bankTransfer.clabe).length === 18
    const dimo = (checkout.dimo ?? {}) as Record<string, unknown>
    const hasDimo = dimo.enabled === true && normalizeClabe(dimo.phone).length >= 10
    const hasPayment = hasStripe || hasMp || hasSpei || hasDimo

    if (hasDelivery && hasPayment) return null

    const missing: string[] = []
    if (!hasDelivery) missing.push('una forma de entrega (envío a domicilio o recolección en mano)')
    if (!hasPayment) missing.push('un método de pago (MercadoPago, Stripe, SPEI o DiMo)')

    return `Para activar este anuncio configura ${missing.join(' y ')}. ` +
      'Ve a Mi tienda → Configuración → Pagos y Envíos.'
  } catch {
    return null // on unexpected error, allow publish (fail open)
  }
}

export type ListingStatusTarget = 'active' | 'paused'
export type SetListingStatusResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Flip a listing's status, with every side effect the single-row PATCH route
 * always ran: viability gate on activate, metadata.paused write, Supabase
 * mirror, ML-close cascade on pause, launchpad notify on activate. Callers:
 * the PATCH route itself (one item) and the bulk-apply loop (many items, one
 * per call — still in-process function calls, not a recursive HTTP
 * round-trip to this same route).
 */
export async function setListingStatus(
  id: string,
  target: ListingStatusTarget,
  ctx: { userId: string; clerkJwt: string },
): Promise<SetListingStatusResult> {
  if (target === 'active') {
    const viabilityError = await checkCheckoutViability(id, ctx.clerkJwt)
    if (viabilityError) return { ok: false, status: 422, error: viabilityError }
  }

  const medusaStatus = target === 'active' ? 'published' : 'draft'
  const res = await medusaFetch(`/store/sellers/me/products/${id}`, ctx.clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({ status: medusaStatus, metadata: { paused: target === 'paused' } }),
  })

  if (res.status === 403) return { ok: false, status: 403, error: 'No tienes permiso para modificar este anuncio.' }
  if (res.status === 404) return { ok: false, status: 404, error: 'Anuncio no encontrado.' }
  if (!res.ok) return { ok: false, status: 500, error: 'Error al actualizar el anuncio.' }

  await db
    .from('marketplace_listings')
    .update({ status: target, updated_at: new Date().toISOString() })
    .eq('medusa_product_id', id)

  if (target === 'paused') await bestEffortCloseMl(ctx.userId, id)
  if (target === 'active') await notifyWriterOnPublish(id).catch(() => {})

  return { ok: true }
}
