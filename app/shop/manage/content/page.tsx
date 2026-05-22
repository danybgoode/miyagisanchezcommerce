import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import ContentClient from './ContentClient'

export const metadata = { title: 'Contenido exclusivo — Mi tienda' }

export default async function ContentPage() {
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

  // Fetch subscription listings so seller can tag content to a specific plan
  const { data: subListings } = await db
    .from('marketplace_listings')
    .select('id, title')
    .eq('shop_id', shop.id)
    .eq('listing_type', 'subscription')
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })

  const { data: content } = await db
    .from('marketplace_subscription_content')
    .select('id, listing_id, title, body, file_url, file_type, is_published, created_at')
    .eq('shop_id', shop.id)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <ContentClient
      shopName={shop.name}
      subscriptionListings={subListings ?? []}
      initialContent={content ?? []}
    />
  )
}
