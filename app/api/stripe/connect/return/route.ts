import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe, getShopStripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'

// GET — Stripe redirects here after seller completes onboarding
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const accountId = req.nextUrl.searchParams.get('account_id')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.redirect(new URL('/sell', req.url))

  // ── Check actual account capabilities from Stripe ─────────────────────────
  let chargesEnabled = false
  let detailsSubmitted = false

  if (accountId) {
    try {
      const account = await stripe.accounts.retrieve(accountId)
      chargesEnabled = account.charges_enabled ?? false
      detailsSubmitted = account.details_submitted ?? false
    } catch {
      // account not found — ignore, will retry on refresh
    }
  }

  // ── Persist updated stripe status ─────────────────────────────────────────
  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const existing = getShopStripe(shop.metadata as Record<string, unknown> | null)

  await db.from('marketplace_shops').update({
    metadata: {
      ...meta,
      settings: {
        ...settings,
        stripe: {
          ...existing,
          account_id: accountId ?? existing.account_id,
          charges_enabled: chargesEnabled,
          details_submitted: detailsSubmitted,
          onboarding_complete: chargesEnabled && detailsSubmitted,
        },
      },
    },
  }).eq('id', shop.id)

  const status = chargesEnabled ? 'connected' : 'pending'
  return NextResponse.redirect(new URL(`/shop/manage/settings?stripe=${status}`, req.url))
}
