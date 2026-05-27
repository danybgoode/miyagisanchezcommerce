import { redirect } from 'next/navigation'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import OrdersInbox from './OrdersInbox'

export const metadata = { title: 'Pedidos — Miyagi Sánchez' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default async function OrdersPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  // Get seller's Medusa seller ID (to find Medusa-backed orders in Supabase)
  let medusaSellerId: string | null = null
  try {
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    if (clerkJwt) {
      const sellerRes = await fetch(`${MEDUSA_BASE}/store/sellers/me`, {
        headers: {
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          Authorization: `Bearer ${clerkJwt}`,
        },
        cache: 'no-store',
      })
      if (sellerRes.ok) {
        const { seller } = await sellerRes.json() as { seller?: { id: string; slug: string; name: string } }
        medusaSellerId = seller?.id ?? null
      }
    }
  } catch { /* proceed without Medusa seller ID */ }

  // Also look up the legacy Supabase shop
  const { data: supabaseShop } = await db
    .from('marketplace_shops')
    .select('id, slug, name')
    .eq('clerk_user_id', user.id)
    .maybeSingle()

  // Need at least one ID to query orders
  const shopIds = [supabaseShop?.id, medusaSellerId].filter(Boolean) as string[]
  if (!shopIds.length) redirect('/sell')

  // Provide a normalized "shop" object for the UI
  const shop = supabaseShop ?? {
    id: medusaSellerId ?? '',
    slug: '',
    name: user.firstName ?? 'Mi tienda',
  }

  // Fetch all active orders by either shop ID
  const { data: orders } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method,
      buyer_name, buyer_email, created_at, updated_at, listing_id, metadata,
      marketplace_shipments(id, carrier, tracking_number, status, estimated_delivery_date)
    `)
    .in('shop_id', shopIds)
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200)

  // Enrich orders that are missing marketplace_listings (Medusa-backed orders don't have
  // a Supabase listing row — their info is in metadata or can be fetched from Medusa)
  const enrichedOrders = (orders ?? []).map((order) => {
    const meta = (order.metadata ?? {}) as Record<string, unknown>
    const listingTitle = (meta.listing_title as string) ?? 'Producto'
    const listingImage = (meta.listing_image as string) ?? null

    return {
      ...order,
      marketplace_listings: (order as any).marketplace_listings ?? {
        id: order.listing_id ?? order.id,
        title: listingTitle,
        images: listingImage ? [{ url: listingImage }] : null,
        listing_type: 'product',
      },
    }
  })

  return (
    <OrdersInbox
      shop={shop}
      initialOrders={enrichedOrders as Parameters<typeof OrdersInbox>[0]['initialOrders']}
    />
  )
}
