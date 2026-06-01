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

async function responseMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as {
    message?: string
    error?: string
  } | null

  return payload?.message ?? payload?.error ?? fallback
}

export type CheckoutProvider = 'stripe' | 'mercadopago' | 'spei' | 'cash'
export type CheckoutFulfillmentMethod = 'local_pickup' | 'shipping' | 'digital' | 'service' | 'rental' | 'coord' | 'none'

export interface CheckoutShippingAddress {
  name?: string
  phone?: string
  /** Street name only (e.g. "Av. Insurgentes Sur") */
  line1?: string
  /** Exterior number (e.g. "1234") */
  ext_number?: string
  /** Interior number, optional (e.g. "Depto 5") */
  int_number?: string
  /** Colonia / neighborhood */
  line2?: string
  /** Alcaldía or municipio (from CP lookup region_2) */
  city?: string
  state?: string
  /** Envia 2-digit state code set by CP lookup */
  state_code?: string
  postal_code?: string
  country?: string
}

export interface CheckoutShippingQuote {
  rateId: string
  carrier: string
  service: string
  amountCents: number
  currency: string
  deliveryEstimate?: number | null
  deliveryLabel?: string | null
}

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
  /** Buyer-selected fulfillment method from marketplace checkout */
  fulfillmentMethod?: CheckoutFulfillmentMethod
  /** Optional selected pickup spot ID/name from seller settings */
  pickupSpotId?: string
  /** Shipping address collected before redirecting to the payment rail */
  shippingAddress?: CheckoutShippingAddress
  /** Buyer-selected live Envia quote */
  shippingQuote?: CheckoutShippingQuote
  /** Buyer explicitly opts into escrow (when seller escrow_mode is 'optional') */
  escrow?: boolean
}

export interface StartCheckoutResult {
  /** Redirect URL for Stripe/MP. Null for SPEI/cash (no external redirect). */
  redirect_url: string | null
  cart_id: string
  payment_session_id: string | null
  /** SPEI: seller's CLABE interbancaria */
  clabe?: string | null
  /** SPEI: seller's bank name */
  bank_name?: string | null
  /** SPEI: account holder name */
  account_holder?: string | null
  /** Escrow mode that was applied, if any */
  escrow_mode?: string | null
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
    offerAmountCents, offerId, clerkJwt, fulfillmentMethod, pickupSpotId, shippingAddress, shippingQuote, escrow,
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
  if (buyerEmail && clerkJwt) {
    try {
      await medusaFetch('/store/customers/sync', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: buyerEmail,
          first_name: buyerFirstName ?? '',
          last_name: buyerLastName ?? '',
        }),
      })
    } catch { /* non-fatal */ }
  }

  // 2. Create cart in the MXN region. Medusa v2 Store cart creation does not
  // accept customer_id; authenticated carts are associated by token/email.
  const cartRes = await medusaFetch('/store/carts', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      region_id: MXN_REGION_ID,
      ...(buyerEmail ? { email: buyerEmail } : {}),
    }),
  })
  if (!cartRes.ok) {
    throw new Error(await responseMessage(cartRes, 'Failed to create cart'))
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
      throw new Error(await responseMessage(itemRes, 'Failed to add item to cart'))
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
      ...(fulfillmentMethod ? { fulfillment_method: fulfillmentMethod } : {}),
      ...(pickupSpotId ? { pickup_spot_id: pickupSpotId } : {}),
      ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
      ...(escrow ? { escrow: true } : {}),
      ...(shippingQuote ? {
        shipping_quote: {
          rate_id: shippingQuote.rateId,
          carrier: shippingQuote.carrier,
          service: shippingQuote.service,
          amount_cents: shippingQuote.amountCents,
          currency: shippingQuote.currency,
          delivery_estimate: shippingQuote.deliveryEstimate ?? null,
          delivery_label: shippingQuote.deliveryLabel ?? null,
        },
      } : {}),
    }),
  })
  if (!checkoutRes.ok) {
    throw new Error(await responseMessage(checkoutRes, 'Failed to start checkout'))
  }

  const result: StartCheckoutResult = await checkoutRes.json()

  // SPEI/cash: complete the cart immediately to create the Medusa order in pending state.
  // No external redirect — the frontend will show bank transfer instructions.
  if ((provider === 'spei' || provider === 'cash') && result.cart_id) {
    const completeRes = await medusaFetch(`/store/carts/${result.cart_id}/complete`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    if (!completeRes.ok) {
      const msg = await responseMessage(completeRes, 'Failed to complete cart')
      throw new Error(msg)
    }
    const { type, order } = await completeRes.json()
    if (type === 'order' && order?.id) {
      result.cart_id = order.id // Return order ID so caller can navigate to order page
    }
  }

  return result
}
