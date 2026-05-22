import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import SubscriptionsClient from './SubscriptionsClient'

export const metadata = { title: 'Suscripciones — Mi tienda' }

export default async function SubscriptionsPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, name')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  const { data: subscriptions } = await db
    .from('marketplace_subscriptions')
    .select(`
      id, buyer_email, buyer_name, status, payment_method,
      current_period_start, current_period_end, cancel_at_period_end, created_at,
      marketplace_listings!inner(id, title, price_cents, currency)
    `)
    .eq('shop_id', shop.id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <SubscriptionsClient
      shopName={shop.name}
      subscriptions={subscriptions ?? []}
    />
  )
}
