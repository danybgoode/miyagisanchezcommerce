import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import AnalyticsClient from './AnalyticsClient'

export const metadata = { title: 'Analíticas — Mi tienda' }
export const revalidate = 300 // revalidate every 5 minutes

export default async function AnalyticsPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  // Get seller's shop
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, name, metadata')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  // ── Fetch all subscriptions for this shop ─────────────────────────────────
  const { data: subs } = await db
    .from('marketplace_subscriptions')
    .select(`
      id, status, payment_method, tier_id, created_at, updated_at,
      buyer_email, buyer_name,
      marketplace_listings!inner(id, title, price_cents, currency, metadata)
    `)
    .eq('shop_id', shop.id)
    .order('created_at', { ascending: false })

  const allSubs = subs ?? []

  // ── Compute analytics ─────────────────────────────────────────────────────
  const active = allSubs.filter(s => s.status === 'active' || s.status === 'trialing')
  const pending = allSubs.filter(s =>
    s.status === 'pending_confirmation' || s.status === 'pending_authorization',
  )

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const newThisMonth = allSubs.filter(s => new Date(s.created_at) >= startOfMonth).length
  const churnedThisMonth = allSubs.filter(
    s => s.status === 'canceled' && new Date(s.updated_at) >= thirtyDaysAgo,
  ).length

  // MRR — for annual subscriptions, divide by 12 to get monthly equivalent
  function getMonthlyAmount(sub: typeof allSubs[0]): number {
    const listing = (sub.marketplace_listings as unknown as { id: string; title: string; price_cents: number | null; currency: string; metadata: unknown })
    if (!listing?.price_cents) return 0

    // Check if this sub is on an annual tier
    const meta = listing.metadata as Record<string, unknown> | null
    const tiers = meta?.subscription_tiers as Array<{ id: string; price_cents: number; interval: string }> | undefined
    if (tiers && sub.tier_id) {
      const tier = tiers.find(t => t.id === sub.tier_id)
      if (tier?.interval === 'year') return Math.round(tier.price_cents / 12)
      if (tier) return tier.price_cents
    }
    const subMeta = meta?.subscription as { interval?: string } | undefined
    if (subMeta?.interval === 'year') return Math.round(listing.price_cents / 12)
    return listing.price_cents
  }

  const mrr = active.reduce((sum, s) => sum + getMonthlyAmount(s), 0)
  const arr = mrr * 12
  const currency = 'MXN'

  // Plan breakdown — group active subs by listing
  const planMap = new Map<string, { title: string; activeCount: number; mrr: number; currency: string }>()
  for (const s of active) {
    const listing = (s.marketplace_listings as unknown as { id: string; title: string; price_cents: number | null; currency: string; metadata: unknown })
    if (!listing) continue
    const key = listing.id
    const existing = planMap.get(key) ?? { title: listing.title, activeCount: 0, mrr: 0, currency: listing.currency ?? 'MXN' }
    planMap.set(key, {
      ...existing,
      activeCount: existing.activeCount + 1,
      mrr: existing.mrr + getMonthlyAmount(s),
    })
  }

  // Recent subs (last 30)
  const recentSubs = allSubs.slice(0, 30).map(s => {
    const listing = s.marketplace_listings as unknown as { id: string; title: string }
    return {
      buyer_email: s.buyer_email,
      buyer_name: s.buyer_name,
      status: s.status,
      payment_method: s.payment_method,
      tier_id: s.tier_id,
      created_at: s.created_at,
      listing_title: listing?.title ?? '—',
    }
  })

  const analyticsData = {
    mrr,
    arr,
    activeCount: active.length,
    newThisMonth,
    churnedThisMonth,
    pendingCount: pending.length,
    currency,
    planBreakdown: [...planMap.values()],
    recentSubs,
  }

  return <AnalyticsClient data={analyticsData} shopName={shop.name} />
}
