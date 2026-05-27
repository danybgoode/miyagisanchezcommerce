/**
 * Medusa cart helpers for the checkout flow.
 *
 * Usage from buy buttons:
 *   const { redirect_url } = await startCheckout({ listingId, provider: 'stripe', buyerEmail })
 *   window.location.href = redirect_url
 */

const MEDUSA_BASE = process.env.NEXT_PUBLIC_MEDUSA_STORE_URL
  ?? process.env.MEDUSA_STORE_URL
  ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const MXN_REGION_ID = process.env.NEXT_PUBLIC_MEDUSA_MXN_REGION_ID
  ?? process.env.MEDUSA_MXN_REGION_ID
  ?? ''

function medusaFetch(path: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      ...(options?.headers ?? {}),
    },
  })
}

export type CheckoutProvider = 'stripe' | 'mercadopago'

export interface StartCheckoutParams {
  /** Medusa product ID (prod_xxx) */
  productId: string
  /** Variant ID — use the first/default variant if known */
  variantId?: string
  provider: CheckoutProvider
  buyerEmail?: string
  buyerFirstName?: string
  buyerLastName?: string
  /** Accepted offer override in centavos */
  offerAmountCents?: number
  /** Supabase offer ID — included in session metadata so the webhook can mark it paid */
  offerId?: string
  /** Clerk JWT — required for authenticated checkout */
  clerkJwt?: string
}

export interface StartCheckoutResult {
  redirect_url: string
  cart_id: string
  payment_session_id: string | null
}

/**
 * Creates a Medusa cart, adds the item, and initiates the external
 * payment checkout session (Stripe Connect / MercadoPago).
 * Returns the redirect URL — caller navigates there.
 */
export async function startCheckout(params: StartCheckoutParams): Promise<StartCheckoutResult> {
  const { productId, variantId, provider, buyerEmail, buyerFirstName, buyerLastName, offerAmountCents, offerId, clerkJwt } = params

  const authHeaders: Record<string, string> = clerkJwt
    ? { Authorization: `Bearer ${clerkJwt}` }
    : {}

  // 1. Sync buyer as a Medusa customer (find-or-create)
  let medusaCustomerId: string | null = null
  if (buyerEmail && clerkJwt) {
    try {
      const syncRes = await medusaFetch('/store/customers/sync', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: buyerEmail,
          first_name: buyerFirstName ?? '',
          last_name: buyerLastName ?? '',
        }),
      })
      if (syncRes.ok) {
        const { customer_id } = await syncRes.json()
        medusaCustomerId = customer_id ?? null
      }
    } catch { /* non-fatal — checkout continues without customer link */ }
  }

  // 2. Resolve the variant ID if not provided
  let resolvedVariantId = variantId
  if (!resolvedVariantId) {
    const productRes = await medusaFetch(`/store/products/${productId}?fields=variants.id`)
    if (!productRes.ok) throw new Error('Product not found')
    const { product } = await productRes.json()
    resolvedVariantId = product?.variants?.[0]?.id
    if (!resolvedVariantId) throw new Error('Product has no variants')
  }

  // 3. Create cart in the MXN region (link to Medusa customer if available)
  const cartRes = await medusaFetch('/store/carts', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      region_id: MXN_REGION_ID,
      ...(medusaCustomerId ? { customer_id: medusaCustomerId } : {}),
      ...(buyerEmail ? { email: buyerEmail } : {}),
    }),
  })
  if (!cartRes.ok) {
    const err = await cartRes.json().catch(() => ({}))
    throw new Error(err.message ?? 'Failed to create cart')
  }
  const { cart } = await cartRes.json()
  const cartId = cart.id

  // 4. Add the line item
  const itemRes = await medusaFetch(`/store/carts/${cartId}/line-items`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ variant_id: resolvedVariantId, quantity: 1 }),
  })
  if (!itemRes.ok) {
    const err = await itemRes.json().catch(() => ({}))
    throw new Error(err.message ?? 'Failed to add item to cart')
  }

  // 5. Call start-checkout to create the external payment session + get redirect URL
  const checkoutRes = await medusaFetch(`/store/carts/${cartId}/start-checkout`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      provider,
      buyer_email: buyerEmail,
      ...(offerAmountCents ? { offer_amount_cents: offerAmountCents } : {}),
      ...(offerId ? { offer_id: offerId } : {}),
    }),
  })
  if (!checkoutRes.ok) {
    const err = await checkoutRes.json().catch(() => ({}))
    throw new Error(err.message ?? 'Failed to start checkout')
  }

  return checkoutRes.json()
}
