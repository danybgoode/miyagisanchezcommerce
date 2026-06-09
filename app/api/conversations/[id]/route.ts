import { NextRequest, NextResponse } from 'next/server'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import { buildTransactionLedger, type LedgerOffer, type LedgerOrder, type LedgerView } from '@/lib/transaction-ledger'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/**
 * Resolve the read-only transaction ledger behind a conversation (C.1). Reads the
 * order on EXISTING keys — `marketplace_orders.metadata.offer_id` → the mirror row →
 * `medusa_order_id`, best-effort enriched with the normalized Medusa order so the
 * payment/refund seams see `payment_received` / `buyer_reported_paid` / `return_request`.
 * Never throws and never mutates: any failure degrades to the offer-only view.
 */
async function resolveLedger(
  offer: LedgerOffer | null,
  offerId: string | null,
  role: 'buyer' | 'seller',
): Promise<{ ledger: LedgerView; orderId: string | null }> {
  let order: LedgerOrder | null = null
  let orderId: string | null = null

  try {
    if (offerId) {
      const { data: mirror } = await db
        .from('marketplace_orders')
        .select('id, status, metadata')
        .eq('metadata->>offer_id', offerId)
        .maybeSingle()

      if (mirror) {
        const meta = (mirror.metadata ?? {}) as Record<string, unknown>
        const medusaOrderId = meta.medusa_order_id as string | undefined
        orderId = medusaOrderId ?? mirror.id
        order = { status: mirror.status as string | null, metadata: meta }

        // Best-effort enrich with the normalized Medusa order (manual-payment +
        // refund flags live there, not on the mirror). Failure → mirror-only.
        if (medusaOrderId) {
          try {
            const { getToken } = await auth()
            const clerkJwt = await getToken()
            const endpoint = role === 'seller'
              ? `${MEDUSA_BASE}/store/sellers/me/orders/${medusaOrderId}`
              : `${MEDUSA_BASE}/store/buyer/me/orders/${medusaOrderId}`
            const res = await fetch(endpoint, {
              headers: {
                'x-publishable-api-key': MEDUSA_PUB_KEY,
                ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
              },
              cache: 'no-store',
            })
            if (res.ok) {
              const { order: medusaOrder } = await res.json() as { order?: Record<string, unknown> }
              if (medusaOrder) order = { ...order, ...(medusaOrder as LedgerOrder) }
            }
          } catch { /* mirror-only */ }
        }
      }
    }
  } catch { /* offer-only */ }

  const ledger = buildTransactionLedger({ offer, order, role })
  return { ledger, orderId }
}

// ── GET — full conversation thread ────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Fetch conversation without offers embed (offers table has no currency column)
  const { data: conv } = await db
    .from('marketplace_conversations')
    .select(`
      id, status, buyer_clerk_user_id, seller_clerk_user_id, last_event_at,
      buyer_unread, seller_unread, offer_id,
      marketplace_listings ( id, title, price_cents, currency, images, status, condition, location, listing_type ),
      marketplace_shops ( id, name, slug, logo_url, metadata, mp_enabled )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 })

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 })

  // Derive currency from listing
  const listingRaw = conv.marketplace_listings as unknown as Array<{ currency: string }> | { currency: string } | null
  const listingCurrency: string = Array.isArray(listingRaw)
    ? (listingRaw[0]?.currency ?? 'MXN')
    : (listingRaw?.currency ?? 'MXN')

  // Fetch offer + events in parallel
  const offerId = (conv as unknown as { offer_id: string | null }).offer_id

  const [eventsResult, offerResult] = await Promise.all([
    db.from('marketplace_conversation_events')
      .select('id, event_type, actor, metadata, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    offerId
      ? db.from('marketplace_offers')
          .select('id, status, offer_amount_cents, counter_amount_cents, counter_message, expires_at, counter_expires_at, checkout_expires_at')
          .eq('id', offerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const offerWithCurrency = offerResult.data
    ? { ...offerResult.data, currency: listingCurrency }
    : null

  const shopRaw = conv.marketplace_shops as unknown as {
    metadata?: Record<string, unknown> | null
    mp_enabled?: boolean | null
  } | null
  const stripeSettings = getShopStripe(shopRaw?.metadata ?? null)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id && stripeSettings.enabled !== false)
  const sellerHasMp = sellerHasMpConnected(shopRaw?.metadata ?? null)
  const checkoutProvider = sellerHasMp ? 'mercadopago' : sellerHasStripe ? 'stripe' : null

  // Read-marking is now explicit via POST .../read (decoupled from polling).

  // ── Transaction ledger (C.1) — read-only projection of the linked order's state ──
  const role = isBuyer ? 'buyer' : 'seller'
  const ledgerOffer: LedgerOffer | null = offerWithCurrency
    ? {
        status: offerWithCurrency.status as LedgerOffer['status'],
        offer_amount_cents: offerWithCurrency.offer_amount_cents,
        counter_amount_cents: offerWithCurrency.counter_amount_cents,
        expires_at: offerWithCurrency.expires_at,
        counter_expires_at: offerWithCurrency.counter_expires_at,
        checkout_expires_at: offerWithCurrency.checkout_expires_at,
        currency: offerWithCurrency.currency,
      }
    : null
  const { ledger, orderId } = await resolveLedger(ledgerOffer, offerId, role)

  return NextResponse.json({
    conversation: { ...conv, marketplace_offers: offerWithCurrency, checkout_provider: checkoutProvider },
    events: eventsResult.data ?? [],
    role,
    transaction: { ledger, orderId },
  })
}
