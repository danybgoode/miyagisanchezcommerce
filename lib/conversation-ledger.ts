/**
 * Server-side resolver for the read-only transaction ledger behind a conversation
 * (C.1). Shared by GET /api/conversations/[id] (client refresh) and the messages
 * page (initial SSR render) so both seed the SAME projection — no flash on load.
 *
 * Reads the order on EXISTING keys — `marketplace_orders.metadata.offer_id` → the
 * mirror row → `medusa_order_id`, best-effort enriched with the normalized Medusa
 * order so the payment/refund seams see `payment_received` / `buyer_reported_paid` /
 * `return_request`. Never throws and never mutates: any failure degrades to the
 * offer-only view. The pure projection lives in `lib/transaction-ledger.ts`.
 */
import 'server-only'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { buildTransactionLedger, type LedgerOffer, type LedgerOrder, type LedgerView } from '@/lib/transaction-ledger'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export interface ConversationLedger {
  ledger: LedgerView
  /** Order id for the deep-link (Medusa order id when present, else mirror id). */
  orderId: string | null
}

export async function resolveConversationLedger(
  offer: LedgerOffer | null,
  offerId: string | null,
  role: 'buyer' | 'seller',
): Promise<ConversationLedger> {
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

  return { ledger: buildTransactionLedger({ offer, order, role }), orderId }
}
