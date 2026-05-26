import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import OrderDetail from './OrderDetail'

export const metadata = { title: 'Detalle de pedido — Miyagi Sánchez' }

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: order } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method, shipping_cost_cents,
      shipping_address, buyer_name, buyer_email, created_at, updated_at,
      marketplace_listings!inner(id, title, images, listing_type, metadata),
      marketplace_shops!inner(id, name, slug, clerk_user_id, metadata),
      marketplace_shipments(
        id, carrier, tracking_number, label_url, status,
        estimated_delivery_date, weight_grams, envia_shipment_id, created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!order) notFound()

  const shop = order.marketplace_shops as unknown as { clerk_user_id: string | null }
  if (shop.clerk_user_id !== user.id) notFound()

  return <OrderDetail order={order as Parameters<typeof OrderDetail>[0]['order']} />
}
