/**
 * MercadoPago client — lazy singleton, same pattern as lib/stripe.ts.
 * Never throws at module evaluation time; errors surface at request time.
 *
 * Architecture note: currently uses the platform's access token so all payments
 * collect to the platform's MP account. When Marketplace seller OAuth is added
 * (future), swap `getMpClient()` for a per-seller token stored in
 * marketplace_shops.metadata.settings.mercadopago.access_token
 */

import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'

// ── Client singleton ──────────────────────────────────────────────────────────

let _client: MercadoPagoConfig | null = null

export function getMpClient(): MercadoPagoConfig {
  if (!_client) {
    const token = process.env.MP_ACCESS_TOKEN
    if (!token) throw new Error('Missing MP_ACCESS_TOKEN environment variable')
    _client = new MercadoPagoConfig({ accessToken: token, options: { timeout: 5000 } })
  }
  return _client
}

// ── Create checkout preference ────────────────────────────────────────────────

export interface CreatePreferenceParams {
  title: string
  /** Stored as integer centavos (e.g. 150000 = MXN $1,500.00) */
  priceCents: number
  currency: string   // 'MXN', 'ARS', 'COP', etc.
  buyerEmail?: string
  listingId: string
  shopId: string
  listingType: string
  offerId?: string
  origin: string
}

export interface MpPreference {
  id: string
  /** Redirect here in production */
  initPoint: string
  /** Redirect here in sandbox / testing */
  sandboxInitPoint: string
}

export async function createMpPreference(p: CreatePreferenceParams): Promise<MpPreference> {
  const preference = new Preference(getMpClient())

  const result = await preference.create({
    body: {
      items: [{
        id: p.listingId,
        title: p.title.slice(0, 256), // MP enforces 256-char limit
        quantity: 1,
        // MP unit_price is in full monetary units (pesos), not centavos
        unit_price: p.priceCents / 100,
        currency_id: p.currency.toUpperCase(),
      }],
      ...(p.buyerEmail ? { payer: { email: p.buyerEmail } } : {}),
      // Passed back verbatim in the webhook — used to correlate with our DB
      external_reference: JSON.stringify({
        listing_id: p.listingId,
        shop_id: p.shopId,
        listing_type: p.listingType,
        offer_id: p.offerId ?? null,
      }),
      notification_url: `${p.origin}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${p.origin}/payment/success?source=mp`,
        failure: `${p.origin}/l/${p.listingId}?payment=failed`,
        pending: `${p.origin}/payment/pending?source=mp`,
      },
      auto_return: 'approved',
      statement_descriptor: 'MIYAGI SANCHEZ',
    },
  })

  return {
    id: result.id!,
    initPoint: result.init_point!,
    sandboxInitPoint: result.sandbox_init_point!,
  }
}

// ── Fetch payment detail ──────────────────────────────────────────────────────

export async function getMpPayment(paymentId: string) {
  const payment = new Payment(getMpClient())
  return payment.get({ id: paymentId })
}
