import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import OrdersInbox from './OrdersInbox'

export const metadata = { title: 'Pedidos — Miyagi Sánchez' }

export default async function OrdersPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name')
    .eq('clerk_user_id', user.id)
    .maybeSingle()

  if (!shop) redirect('/sell')

  // Fetch all non-pending orders for the shop
  const { data: orders } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method,
      buyer_name, buyer_email, created_at, updated_at,
      marketplace_listings!inner(id, title, images, listing_type),
      marketplace_shipments(id, carrier, tracking_number, status, estimated_delivery_date)
    `)
    .eq('shop_id', shop.id)
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <OrdersInbox
      shop={shop}
      initialOrders={orders ?? []}
    />
  )
}
