import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe, createAccountLink, getShopStripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'

// GET — initiate Stripe Connect onboarding for the current seller
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }

  // Fetch shop
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) {
    return NextResponse.redirect(new URL('/sell', req.url))
  }

  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const stripeSettings = getShopStripe(shop.metadata as Record<string, unknown> | null)

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`

  // ── Create or retrieve Connect account ───────────────────────────────────
  let accountId = stripeSettings.account_id

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'MX',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        mcc: '5999', // miscellaneous retail
      },
    })
    accountId = account.id

    // Persist the account ID immediately (before onboarding completes)
    await db.from('marketplace_shops').update({
      metadata: {
        ...meta,
        settings: {
          ...settings,
          stripe: { account_id: accountId, charges_enabled: false, onboarding_complete: false },
        },
      },
    }).eq('id', shop.id)
  }

  // Generate onboarding link
  const url = await createAccountLink(accountId, origin)
  return NextResponse.redirect(url)
}
