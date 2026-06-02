/**
 * POST /api/orders/finalize-manual
 *
 * Sends the buyer + seller confirmation emails for a manual ("Pago directo")
 * order. Manual orders complete inline (lib/cart.ts) and never hit the Stripe/MP
 * webhooks that send these emails, so the frontend calls this right after
 * completing the cart. Fire-and-forget — failures never block checkout.
 *
 * Body: { orderId }    Auth: Clerk JWT (Authorization header), forwarded to Medusa.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  getSellerEmail,
  sendManualOrderToBuyer,
  sendManualOrderToSeller,
  type ManualPaymentSnapshot,
} from '@/lib/email'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 0 }).format((cents ?? 0) / 100)
}

export async function POST(req: NextRequest) {
  let body: { orderId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }
  const orderId = body.orderId
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    // Order context (buyer email, items, amount, manual instructions)
    const res = await fetch(`${MEDUSA_BASE}/store/customers/me/orders/${orderId}`, {
      headers: { 'x-publishable-api-key': PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ ok: false, reason: 'order not found' }, { status: 200 })
    const { order } = await res.json() as { order: any }

    if (order?.payment_method !== 'manual' || !order?.manual_payment) {
      return NextResponse.json({ ok: false, reason: 'not a manual order' }, { status: 200 })
    }

    const productId = order.marketplace_listings?.id as string | undefined
    const buyerEmail = order.buyer_email as string | null
    const amountStr = fmt(order.amount_cents ?? 0, order.currency ?? 'MXN')

    // Listing title + seller clerk id + shop name from the Supabase mirror.
    let listingTitle = order.marketplace_listings?.title ?? 'Producto'
    let shopName = order.marketplace_shops?.name ?? 'la tienda'
    let sellerClerkId: string | null = null
    if (productId) {
      const { data: listing } = await db
        .from('marketplace_listings')
        .select('title, marketplace_shops!inner(name, clerk_user_id)')
        .eq('medusa_product_id', productId)
        .maybeSingle()
      if (listing) {
        listingTitle = (listing.title as string) ?? listingTitle
        const shop = listing.marketplace_shops as unknown as { name: string; clerk_user_id: string | null }
        shopName = shop?.name ?? shopName
        sellerClerkId = shop?.clerk_user_id ?? null
      }
    }

    const listingUrl = productId ? `${SITE}/l/${productId}` : SITE
    const buyerOrderUrl = `${SITE}/account/orders/${orderId}`
    const sellerOrderUrl = `${SITE}/shop/manage/orders/${orderId}`

    // Buyer email — pending payment + instructions
    if (buyerEmail) {
      await sendManualOrderToBuyer({
        buyerEmail,
        buyerName: order.buyer_name ?? null,
        listingTitle,
        listingUrl,
        amountToPay: amountStr,
        shopName,
        manualPayment: order.manual_payment as ManualPaymentSnapshot,
        orderUrl: buyerOrderUrl,
      }).catch(e => console.error('[finalize-manual] buyer email:', e))
    }

    // Seller email — new order, confirm payment when received
    if (sellerClerkId) {
      const sellerEmail = await getSellerEmail(sellerClerkId)
      if (sellerEmail) {
        await sendManualOrderToSeller({
          sellerEmail,
          listingTitle,
          listingUrl,
          amount: amountStr,
          buyerName: order.buyer_name ?? null,
          buyerEmail,
          shopName,
          orderUrl: sellerOrderUrl,
        }).catch(e => console.error('[finalize-manual] seller email:', e))
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[finalize-manual] error:', e)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
