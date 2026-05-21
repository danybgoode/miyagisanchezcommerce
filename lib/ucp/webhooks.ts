/**
 * UCP Order Webhooks — HMAC-SHA256 signed delivery
 *
 * When an order is paid (via MercadoPago, Stripe, or manual),
 * we fire a signed POST to the shop's configured ucp_webhook_url.
 *
 * Payload: { event, order, listing, buyer }
 * Signature header: X-UCP-Signature: sha256=<hex>
 *
 * Retry policy: 3 attempts with exponential back-off (0, 2s, 8s).
 * Failures are logged but never throw — orders are never blocked.
 */

import { db } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export type UcpWebhookEvent = 'order.created' | 'order.paid' | 'order.shipped' | 'order.cancelled'

export interface UcpWebhookPayload {
  event:     UcpWebhookEvent
  timestamp: string
  order: {
    id:              string
    status:          string
    amount_cents:    number
    currency:        string
    payment_method:  string | null
    created_at:      string
  }
  listing: {
    id:    string
    title: string
    url:   string
  }
  buyer: {
    email: string
    name:  string | null
  }
  shop: {
    id: string
  }
}

// ── HMAC helper ───────────────────────────────────────────────────────────────

async function signPayload(body: string, secret: string): Promise<string> {
  const enc  = new TextEncoder()
  const key  = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex  = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${hex}`
}

// ── Delivery with retry ───────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [0, 2000, 8000]

async function deliver(url: string, body: string, signature: string): Promise<boolean> {
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-UCP-Signature':  signature,
          'X-UCP-Version':    '1',
          'User-Agent':       'MiyagiSanchez-UCP/1.0',
        },
        body,
        signal: AbortSignal.timeout(10_000), // 10s per attempt
      })
      if (res.ok) return true
      console.warn(`[ucp-webhook] attempt ${attempt + 1} got HTTP ${res.status} from ${url}`)
    } catch (err) {
      console.warn(`[ucp-webhook] attempt ${attempt + 1} fetch error:`, err)
    }
  }
  return false
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire a UCP webhook for a given order.
 * Looks up the shop's webhook URL + secret from the DB.
 * Non-throwing — failures are logged only.
 */
export async function deliverOrderWebhook(
  orderId: string,
  event: UcpWebhookEvent = 'order.created'
): Promise<void> {
  try {
    // Fetch order + related listing + shop webhook config in one query
    const { data: order } = await db
      .from('marketplace_orders')
      .select(`
        id, status, amount_cents, currency, payment_method, created_at,
        buyer_email, buyer_name, shop_id,
        marketplace_listings!inner(id, title),
        marketplace_shops!inner(id, ucp_webhook_url, ucp_webhook_secret)
      `)
      .eq('id', orderId)
      .maybeSingle()

    if (!order) {
      console.warn(`[ucp-webhook] order ${orderId} not found`)
      return
    }

    const shop = order.marketplace_shops as unknown as {
      id: string
      ucp_webhook_url: string | null
      ucp_webhook_secret: string | null
    }

    if (!shop.ucp_webhook_url || !shop.ucp_webhook_secret) return  // not configured

    const listing = order.marketplace_listings as unknown as { id: string; title: string }

    const payload: UcpWebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      order: {
        id:             order.id,
        status:         order.status,
        amount_cents:   order.amount_cents ?? 0,
        currency:       order.currency ?? 'MXN',
        payment_method: order.payment_method ?? null,
        created_at:     order.created_at,
      },
      listing: {
        id:    listing.id,
        title: listing.title,
        url:   `https://miyagisanchez.com/l/${listing.id}`,
      },
      buyer: {
        email: order.buyer_email,
        name:  order.buyer_name ?? null,
      },
      shop: {
        id: shop.id,
      },
    }

    const body      = JSON.stringify(payload)
    const signature = await signPayload(body, shop.ucp_webhook_secret)
    const ok        = await deliver(shop.ucp_webhook_url, body, signature)

    if (!ok) {
      console.error(`[ucp-webhook] all retries exhausted for order ${orderId} → ${shop.ucp_webhook_url}`)
    }
  } catch (err) {
    console.error('[ucp-webhook] unexpected error:', err)
  }
}
