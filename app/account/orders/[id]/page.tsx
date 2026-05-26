import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import OrderTrackingClient from './OrderTrackingClient'

export const metadata = { title: 'Detalle de compra — Miyagi Sánchez' }

export default async function BuyerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''

  const { data: order } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method, shipping_address,
      buyer_name, buyer_email, buyer_clerk_user_id, created_at, updated_at,
      marketplace_listings!inner(id, title, images, listing_type),
      marketplace_shops!inner(id, name, slug),
      marketplace_shipments(
        id, carrier, tracking_number, label_url, status,
        estimated_delivery_date, created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!order) notFound()

  // Access control: buyer only
  const isBuyer =
    order.buyer_clerk_user_id === user.id ||
    order.buyer_email?.toLowerCase() === buyerEmail.toLowerCase()

  if (!isBuyer) notFound()

  return <OrderTrackingClient order={order as Parameters<typeof OrderTrackingClient>[0]['order']} />
}
