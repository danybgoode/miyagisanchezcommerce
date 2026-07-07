/**
 * Frontend bridge for the seller MCP's order-read tool (ml-orders-native S3 ·
 * US-9). Mirrors `lib/seller-products.ts`'s `patchSellerProductViaInternal`
 * shape: the agent token has no Clerk JWT, so this calls the backend's
 * internal route (shared secret) instead of the Clerk-gated seller route.
 */

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export interface AgentOrderView {
  id: string
  status: string
  source: string
  tags: string[]
  amount_cents: number
  currency: string
  buyer_name: string | null
  buyer_email: string | null
  created_at: string
  marketplace_shipments: Array<{ carrier: string; tracking_number: string | null; status: string }> | null
}

/** List a shop's orders (all channels) through the backend internal route. */
export async function listShopOrdersViaInternal(
  sellerSlug: string,
): Promise<{ ok: boolean; orders?: AgentOrderView[]; error?: string }> {
  if (!INTERNAL_SECRET) return { ok: false, error: 'Internal secret not configured.' }
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/sellers/orders?seller_slug=${encodeURIComponent(sellerSlug)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET } },
    )
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: false, error: d.message ?? `Error ${res.status}` }
    }
    const data = (await res.json()) as { orders: AgentOrderView[] }
    return { ok: true, orders: data.orders ?? [] }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
