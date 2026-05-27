import { redirect } from 'next/navigation'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import AccountOrdersClient from './AccountOrdersClient'

export const metadata = { title: 'Mis compras — Miyagi Sánchez' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default async function AccountOrdersPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''

  // ── Fetch Supabase orders (legacy + Medusa-backed recorded here) ──────────
  const { data: rawOrders } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method,
      buyer_name, buyer_email, created_at, updated_at, listing_id, metadata,
      marketplace_shipments(id, carrier, tracking_number, status, estimated_delivery_date)
    `)
    .or(`buyer_clerk_user_id.eq.${user.id},buyer_email.ilike.${buyerEmail}`)
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)

  // Track Medusa order IDs already present in Supabase to avoid duplicates
  const supabaseMedusaIds = new Set<string>()
  const supabaseOrders = (rawOrders ?? []).map((order) => {
    const meta = (order.metadata ?? {}) as Record<string, unknown>
    if (meta.medusa_order_id) supabaseMedusaIds.add(meta.medusa_order_id as string)
    return {
      ...order,
      _source: 'supabase',
      marketplace_listings: (order as any).marketplace_listings ?? {
        id: order.listing_id ?? order.id,
        title: (meta.listing_title as string) ?? 'Producto',
        images: (meta.listing_image as string) ? [{ url: meta.listing_image as string }] : null,
        listing_type: 'product',
      },
      marketplace_shops: (order as any).marketplace_shops ?? {
        id: '',
        name: 'Vendedor',
        slug: '',
      },
    }
  })

  // ── Fetch Medusa orders directly (for orders not yet in Supabase) ─────────
  let medusaOnlyOrders: any[] = []
  try {
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    if (clerkJwt) {
      const res = await fetch(`${MEDUSA_BASE}/store/customers/me/orders`, {
        headers: {
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          Authorization: `Bearer ${clerkJwt}`,
        },
        cache: 'no-store',
      })
      if (res.ok) {
        const { orders: mOrders } = await res.json() as { orders?: any[] }
        // Only include orders not already tracked in Supabase
        medusaOnlyOrders = (mOrders ?? []).filter(
          (o: any) => !supabaseMedusaIds.has(o._medusa_order_id ?? o.id)
        )
      }
    }
  } catch { /* non-fatal — show Supabase orders only */ }

  // ── Merge: Supabase first (has shipment data), then Medusa-only ────────────
  const orders = [
    ...supabaseOrders,
    ...medusaOnlyOrders,
  ].sort((a, b) => {
    const aTime = new Date(a.created_at ?? 0).getTime()
    const bTime = new Date(b.created_at ?? 0).getTime()
    return bTime - aTime  // descending
  })

  return <AccountOrdersClient orders={orders as Parameters<typeof AccountOrdersClient>[0]['orders']} />
}
