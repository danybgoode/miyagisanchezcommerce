import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import OfferInbox from './OfferInbox'

export const metadata = { title: 'Ofertas — Miyagi Sánchez' }

export default async function OffersPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  // Get seller's shop
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, name, slug')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  // Fetch all non-terminal offers for this shop, newest first
  const { data: offers } = await db
    .from('marketplace_offers')
    .select(`
      id, offer_amount_cents, message, status, expires_at,
      counter_amount_cents, counter_message, counter_expires_at,
      buyer_name, buyer_email, created_at, updated_at,
      listing_id,
      marketplace_listings!inner(
        id, title, price_cents, currency, images, status, listing_type
      )
    `)
    .eq('shop_id', shop.id)
    .not('status', 'in', '("withdrawn","expired","paid")')
    .order('status', { ascending: true })   // pending first
    .order('created_at', { ascending: false })
    .limit(100)

  // Supabase returns joined rows as arrays in its TS types but the !inner join
  // always resolves to a single object at runtime. Cast to our tighter type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (
    <OfferInbox
      shopId={shop.id}
      shopSlug={shop.slug}
      initialOffers={(offers ?? []) as unknown as Parameters<typeof OfferInbox>[0]['initialOffers']}
    />
  )
}
