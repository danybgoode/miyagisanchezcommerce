import 'server-only'
/**
 * The buyer + seller confirmation emails for a manual ("Pago directo") order.
 *
 * ── WHY THIS IS A LIBRARY AND NOT JUST A ROUTE ───────────────────────────────
 * It used to live only in `POST /api/orders/finalize-manual`, and `lib/cart.ts`
 * reached it with `fetch(`${SITE_URL}/api/orders/finalize-manual`)`. That worked
 * when `startCheckout` ran in the browser (the session cookie rode along). PR 244
 * moved `startCheckout` behind `/api/checkout/start` to keep Medusa credentials out
 * of the client bundle — and a server-side fetch to your own origin carries no Clerk
 * cookie, so `getToken()` returned null and the route answered **401 every time**.
 *
 * The call was fire-and-forget with `.catch(() => {})`, so nothing logged, nothing
 * alerted, and every single "pago directo" order placed through the web UI between
 * 2026-07-13 and 2026-08-15 sent NO confirmation email to the buyer and NO new-order
 * email to the seller. It was found by tracing one order's access log, not by any
 * test or monitor.
 *
 * The fix is not "forward the cookie" — it is to stop making an authenticated HTTP
 * request to ourselves for work we are already authorised to do. `lib/cart.ts` calls
 * this function directly; the route stays as a thin wrapper for any external caller.
 *
 * Contract: NEVER throws. Returns a reason so a caller can log the miss rather than
 * assume delivery.
 */
import { db } from '@/lib/supabase'
import {
  getSellerEmail,
  sendManualOrderToBuyer,
  sendManualOrderToSeller,
  type EmailPersonalization,
  type ManualPaymentSnapshot,
} from '@/lib/email'
import { dispatchToBuyer } from '@/lib/notifications/dispatch'
import { buildBuyerMessage } from '@/lib/notifications/buyer-messages'
import { isEnabled } from '@/lib/flags'
import { resolveBuyerClerkId } from '@/lib/order-buyer'
import { listingUrlFor } from '@/lib/market-url'
import type { RentalBookingLike } from '@/lib/rental-booking'
import { formatOrderCurrency } from '@/lib/market-presentation'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? process.env.MEDUSA_PUBLISHABLE_KEY ?? ''
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

function fmt(cents: number, currency: string) {
  return formatOrderCurrency((cents ?? 0), currency || 'MXN')
}

type ManualOrder = {
  payment_method?: string
  manual_payment?: ManualPaymentSnapshot | null
  marketplace_listings?: { id?: string; title?: string } | null
  marketplace_shops?: { name?: string } | null
  buyer_email?: string | null
  buyer_name?: string | null
  amount_cents?: number
  currency?: string
  personalization?: EmailPersonalization | null
  rental_booking?: RentalBookingLike | null
}

export type ManualOrderEmailsInput = {
  orderId: string
  /** The BUYER's Clerk JWT — the order read is buyer-scoped in Medusa. */
  clerkJwt: string | null | undefined
  /**
   * The buyer's Clerk user id, for the push/Telegram fan-out. Must be derived
   * server-side from the session, never accepted from a request body: it addresses
   * a notification, so a caller-supplied value would let anyone push to anyone.
   */
  buyerClerkUserId?: string | null
}

export type ManualOrderEmailsResult = {
  ok: boolean
  /** Why nothing was sent. Present exactly when `ok` is false. */
  reason?: 'no_auth' | 'order_not_found' | 'not_manual' | 'error'
  buyer_email_sent?: boolean
  seller_email_sent?: boolean
}

export async function sendManualOrderEmails(
  input: ManualOrderEmailsInput,
): Promise<ManualOrderEmailsResult> {
  const { orderId, clerkJwt, buyerClerkUserId = null } = input

  // Said out loud rather than swallowed. A manual order whose emails could not be
  // sent is a real operational fact — the seller does not know they made a sale.
  if (!clerkJwt) {
    console.error('[manual-order-emails] no buyer JWT — NO confirmation email sent for', orderId)
    return { ok: false, reason: 'no_auth' }
  }

  try {
    const res = await fetch(`${MEDUSA_BASE}/store/buyer/me/orders/${orderId}`, {
      headers: { 'x-publishable-api-key': PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[manual-order-emails] order read failed', orderId, res.status)
      return { ok: false, reason: 'order_not_found' }
    }
    const { order } = await res.json() as { order: ManualOrder | null }

    if (order?.payment_method !== 'manual' || !order?.manual_payment) {
      return { ok: false, reason: 'not_manual' }
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

    const listingUrl = productId ? listingUrlFor(SITE, productId) : SITE
    const buyerOrderUrl = `${SITE}/account/orders/${orderId}`
    const sellerOrderUrl = `${SITE}/shop/manage/orders/${orderId}`

    let buyerSent = false
    let sellerSent = false

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
        personalization: order.personalization ?? [],
        rentalBooking: order.rental_booking ?? null,
        currency: order.currency ?? 'MXN',
      })
        .then(() => { buyerSent = true })
        .catch(e => console.error('[manual-order-emails] buyer email:', e))

      // ── Compras (Push/Telegram) — additive only; the email above is untouched.
      const buyerMoneypathEnabled = await isEnabled('notifications.buyer_moneypath_enabled')
      const buyerClerkId = resolveBuyerClerkId(buyerClerkUserId, buyerMoneypathEnabled)
      const buyerMsg = buildBuyerMessage('payment_confirmed', {
        listingTitle,
        url: buyerOrderUrl,
        amountPaid: amountStr,
      })
      void dispatchToBuyer(
        { clerkUserId: buyerClerkId, email: buyerEmail },
        { group: 'buyer.compras', push: buyerMsg.push, telegram: buyerMsg.telegram },
      )
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
          personalization: order.personalization ?? [],
          rentalBooking: order.rental_booking ?? null,
          currency: order.currency ?? 'MXN',
        })
          .then(() => { sellerSent = true })
          .catch(e => console.error('[manual-order-emails] seller email:', e))
      } else {
        console.error('[manual-order-emails] seller has no email address:', sellerClerkId)
      }
    } else {
      // An unclaimed (supply-imported) shop has no Clerk owner to email. Named, not
      // silently skipped — it means a real order nobody was told about.
      console.error('[manual-order-emails] order', orderId, 'has no seller Clerk id — seller NOT notified')
    }

    return { ok: true, buyer_email_sent: buyerSent, seller_email_sent: sellerSent }
  } catch (e) {
    console.error('[manual-order-emails] error:', e)
    return { ok: false, reason: 'error' }
  }
}
