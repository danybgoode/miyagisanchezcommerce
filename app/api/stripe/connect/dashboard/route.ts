/**
 * GET /api/stripe/connect/dashboard
 *
 * Redirects the authenticated seller to their Stripe Express Dashboard.
 * Calls stripe.accounts.createLoginLink() which returns a one-time URL
 * that opens the seller's Express Dashboard directly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import { getShopStripe } from '@/lib/stripe'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`
    return NextResponse.redirect(new URL('/sign-in', origin))
  }

  // ── Fetch seller's shop ──────────────────────────────────────────────────
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`
  const settingsUrl = new URL('/shop/manage/settings', origin)

  if (!shop) {
    return NextResponse.redirect(new URL('/sell', origin))
  }

  const stripeSettings = getShopStripe(shop.metadata as Record<string, unknown> | null)

  if (!stripeSettings.account_id) {
    return NextResponse.redirect(
      new URL('/shop/manage/settings?stripe=error&reason=No+hay+cuenta+Stripe+conectada.', origin),
    )
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(stripeSettings.account_id)
    return NextResponse.redirect(loginLink.url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al acceder al panel Stripe.'
    const url = new URL('/shop/manage/settings', origin)
    url.searchParams.set('stripe', 'error')
    url.searchParams.set('reason', msg)
    return NextResponse.redirect(url)
  }
}
