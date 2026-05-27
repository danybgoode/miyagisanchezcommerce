import { redirect, notFound } from 'next/navigation'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import OrderDetail from './OrderDetail'

export const metadata = { title: 'Detalle de pedido — Miyagi Sánchez' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  // Fetch base order from Supabase (both legacy and Medusa orders live here)
  const { data: baseOrder } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method, shipping_cost_cents,
      shipping_address, buyer_name, buyer_email, buyer_clerk_user_id,
      created_at, updated_at, listing_id, shop_id, metadata,
      marketplace_shipments(
        id, carrier, tracking_number, label_url, status,
        estimated_delivery_date, weight_grams, envia_shipment_id, created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!baseOrder) notFound()

  const meta = (baseOrder.metadata ?? {}) as Record<string, unknown>
  const medusaOrderId = meta.medusa_order_id as string | undefined

  let order: Parameters<typeof OrderDetail>[0]['order']

  if (medusaOrderId) {
    // ── Medusa-backed order: fetch from Medusa backend ──────────────────────
    const { getToken } = await auth()
    const clerkJwt = await getToken()

    let medusaOrder: Record<string, unknown> | null = null
    if (clerkJwt) {
      try {
        const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${medusaOrderId}`, {
          headers: {
            'x-publishable-api-key': MEDUSA_PUB_KEY,
            Authorization: `Bearer ${clerkJwt}`,
          },
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json() as { order: Record<string, unknown> }
          medusaOrder = data.order
        }
      } catch { /* fall back to Supabase data */ }
    }

    if (medusaOrder) {
      // Use Medusa data (richer) but keep Supabase ID for routing
      order = {
        id: baseOrder.id,  // Supabase ID for API calls
        status: (medusaOrder.status as string) ?? baseOrder.status,
        amount_cents: (medusaOrder.amount_cents as number) ?? baseOrder.amount_cents,
        currency: (medusaOrder.currency as string) ?? baseOrder.currency,
        shipping_method: baseOrder.shipping_method ?? 'standard',
        shipping_cost_cents: baseOrder.shipping_cost_cents ?? 0,
        shipping_address: (medusaOrder.shipping_address as Record<string, string> | null) ?? (baseOrder.shipping_address as Record<string, string> | null),
        buyer_name: (medusaOrder.buyer_name as string | null) ?? baseOrder.buyer_name,
        buyer_email: (medusaOrder.buyer_email as string | null) ?? baseOrder.buyer_email,
        created_at: (medusaOrder.created_at as string) ?? baseOrder.created_at,
        updated_at: (medusaOrder.updated_at as string) ?? baseOrder.updated_at,
        marketplace_listings: (medusaOrder.marketplace_listings as any) ?? {
          id: baseOrder.listing_id ?? baseOrder.id,
          title: 'Producto',
          images: null,
          listing_type: 'product',
          metadata: null,
        },
        marketplace_shops: (medusaOrder.marketplace_shops as any) ?? {
          id: baseOrder.shop_id ?? '',
          name: 'Vendedor',
          slug: '',
          clerk_user_id: user.id,
          metadata: null,
        },
        marketplace_shipments: (medusaOrder.marketplace_shipments as any) ?? (baseOrder.marketplace_shipments as any),
      }
    } else {
      // Medusa fetch failed — show what we have from Supabase
      order = buildFallbackOrder(baseOrder, user.id)
    }
  } else {
    // ── Legacy Supabase order ───────────────────────────────────────────────
    const { data: fullOrder } = await db
      .from('marketplace_orders')
      .select(`
        id, status, amount_cents, currency, shipping_method, shipping_cost_cents,
        shipping_address, buyer_name, buyer_email, buyer_clerk_user_id,
        created_at, updated_at,
        marketplace_listings!inner(id, title, images, listing_type, metadata),
        marketplace_shops!inner(id, name, slug, clerk_user_id, metadata),
        marketplace_shipments(
          id, carrier, tracking_number, label_url, status,
          estimated_delivery_date, weight_grams, envia_shipment_id, created_at
        )
      `)
      .eq('id', id)
      .maybeSingle()

    if (!fullOrder) notFound()

    const shop = (fullOrder as any).marketplace_shops as { clerk_user_id: string | null }
    if (shop.clerk_user_id !== user.id) notFound()

    order = fullOrder as Parameters<typeof OrderDetail>[0]['order']
  }

  return <OrderDetail order={order} />
}

function buildFallbackOrder(
  row: Record<string, unknown>,
  clerkUserId: string,
): Parameters<typeof OrderDetail>[0]['order'] {
  return {
    id: row.id as string,
    status: row.status as string,
    amount_cents: row.amount_cents as number,
    currency: row.currency as string,
    shipping_method: (row.shipping_method as string) ?? 'standard',
    shipping_cost_cents: (row.shipping_cost_cents as number) ?? 0,
    shipping_address: (row.shipping_address as Record<string, string> | null) ?? null,
    buyer_name: row.buyer_name as string | null,
    buyer_email: row.buyer_email as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    marketplace_listings: {
      id: (row.listing_id as string) ?? (row.id as string),
      title: 'Producto',
      images: null,
      listing_type: 'product',
      metadata: null,
    },
    marketplace_shops: {
      id: (row.shop_id as string) ?? '',
      name: 'Mi tienda',
      slug: '',
      clerk_user_id: clerkUserId,
      metadata: null,
    },
    marketplace_shipments: (row.marketplace_shipments as any) ?? null,
  }
}
