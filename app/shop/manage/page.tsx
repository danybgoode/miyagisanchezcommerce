import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import ManageDashboard from './ManageDashboard'

export const metadata = {
  title: 'Mi tienda — Miyagi Sánchez',
}

export default async function ManagePage() {
  const user = await currentUser()
  // Middleware protects this route, but be defensive
  if (!user) redirect('/sign-in')

  // ── Fetch shop ──────────────────────────────────────────────────────────────
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, location')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // No shop yet — send them through the onboarding wizard
  if (!shop) redirect('/sell')

  // ── Fetch listings + pending offers count in parallel ──────────────────────
  const [{ data: listings }, { count: pendingOffersCount }] = await Promise.all([
    db
      .from('marketplace_listings')
      .select('id, title, price_cents, currency, category, listing_type, condition, status, views, images, created_at')
      .eq('shop_id', shop.id)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false }),
    db
      .from('marketplace_offers')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('status', 'pending'),
  ])

  return (
    <ManageDashboard
      shop={shop}
      initialListings={listings ?? []}
      pendingOffersCount={pendingOffersCount ?? 0}
    />
  )
}
