import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import AccountOrdersClient from './AccountOrdersClient'

export const metadata = { title: 'Mis compras — Miyagi Sánchez' }

export default async function AccountOrdersPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const buyerEmail = user.emailAddresses?.[0]?.emailAddress ?? ''

  const { data: orders } = await db
    .from('marketplace_orders')
    .select(`
      id, status, amount_cents, currency, shipping_method,
      buyer_name, buyer_email, created_at, updated_at,
      marketplace_listings!inner(id, title, images, listing_type),
      marketplace_shops!inner(id, name, slug),
      marketplace_shipments(id, carrier, tracking_number, status, estimated_delivery_date)
    `)
    .or(`buyer_clerk_user_id.eq.${user.id},buyer_email.ilike.${buyerEmail}`)
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)

  return <AccountOrdersClient orders={orders ?? []} />
}
