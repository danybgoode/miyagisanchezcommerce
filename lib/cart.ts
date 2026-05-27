/**
 * Medusa cart helpers for the checkout flow.
 *
 * Single-item (BuyButton/MercadoPagoButton):
 *   const { redirect_url } = await startCheckout({ productId, provider, buyerEmail })
 *
 * Multi-item (CartDrawer — items from same seller):
 *   const { redirect_url } = await startCheckout({ items: [...], sellerId, provider, buyerEmail })
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
  /** Single-item shorthand — still works for BuyButton / MercadoPagoButton */
  productId?: string
  variantId?: string | null
  /** Multi-item bundle (CartDrawer — all items must be same seller) */
  items?: Array<{ productId: string; variantId?: string | null }>
  /** Pass seller ID to skip the expensive server-side scan */
  sellerId?: string
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
 * Creates a Medusa cart, adds all items, and initiates the external
 * payment checkout session (Stripe Connect / MercadoPago).
 * Returns the redirect URL — caller navigates there.
 */
export async function startCheckout(params: StartCheckoutParams): Promise<StartCheckoutResult> {
  const {
    productId, variantId, items, sellerId,
    provider, buyerEmail, buyerFirstName, buyerLastName,
    offerAmountCents, offerId, clerkJwt,
  } = params

  // Normalise to array — single-item path is the same as multi-item with one entry
  const lineItems: Array<{ productId: string; variantId?: string | null }> =
    items && items.length > 0
      ? items
      : productId
        ? [{ productId, variantId }]
        : []

  if (lineItems.length === 0) throw new Error('No items to checkout')

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
    } catch { /* non-fatal */ }
  }

  // 2. Create cart in the MXN region
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
    throw new Error((err as any).message ?? 'Failed to create cart')
  }
  const { cart } = await cartRes.json()
  const cartId = cart.id

  // 3. Add each item (resolve variant ID on-the-fly if missing)
  for (const lineItem of lineItems) {
    let resolvedVariantId = lineItem.variantId ?? null

    if (!resolvedVariantId) {
      const productRes = await medusaFetch(`/store/products/${lineItem.productId}?fields=variants.id`)
      if (!productRes.ok) throw new Error(`Product ${lineItem.productId} not found`)
      const { product } = await productRes.json()
      resolvedVariantId = product?.variants?.[0]?.id ?? null
      if (!resolvedVariantId) throw new Error(`Product ${lineItem.productId} has no variants`)
    }

    const itemRes = await medusaFetch(`/store/carts/${cartId}/line-items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ variant_id: resolvedVariantId, quantity: 1 }),
    })
    if (!itemRes.ok) {
      const err = await itemRes.json().catch(() => ({}))
      throw new Error((err as any).message ?? 'Failed to add item to cart')
    }
  }

  // 4. Call start-checkout to create the external payment session + get redirect URL
  const checkoutRes = await medusaFetch(`/store/carts/${cartId}/start-checkout`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      provider,
      buyer_email: buyerEmail,
      ...(sellerId ? { seller_id: sellerId } : {}),
      ...(offerAmountCents ? { offer_amount_cents: offerAmountCents } : {}),
      ...(offerId ? { offer_id: offerId } : {}),
    }),
  })
  if (!checkoutRes.ok) {
    const err = await checkoutRes.json().catch(() => ({}))
    throw new Error((err as any).message ?? 'Failed to start checkout')
  }

  return checkoutRes.json()
}
