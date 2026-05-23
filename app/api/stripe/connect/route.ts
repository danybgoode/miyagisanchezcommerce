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

  const errorRedirect = (reason: string) =>
    NextResponse.redirect(
      new URL(`/shop/manage/settings?stripe=error&reason=${encodeURIComponent(reason)}`, req.url),
    )

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
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[stripe/connect] accounts.create failed:', msg)
      return errorRedirect(msg)
    }
  }

  // ── Generate onboarding link ─────────────────────────────────────────────
  // If accountId came from a stale/previous attempt and accountLinks.create fails,
  // clear it and retry once with a fresh account.
  try {
    const url = await createAccountLink(accountId, origin)
    return NextResponse.redirect(url)
  } catch (linkErr) {
    const linkMsg = linkErr instanceof Error ? linkErr.message : String(linkErr)
    console.error('[stripe/connect] accountLinks.create failed for', accountId, ':', linkMsg)

    // Stale account ID — clear it and try creating a brand-new account
    if (stripeSettings.account_id) {
      try {
        const freshAccount = await stripe.accounts.create({
          type: 'express',
          country: 'MX',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: { mcc: '5999' },
        })
        const freshId = freshAccount.id

        await db.from('marketplace_shops').update({
          metadata: {
            ...meta,
            settings: {
              ...settings,
              stripe: { account_id: freshId, charges_enabled: false, onboarding_complete: false },
            },
          },
        }).eq('id', shop.id)

        const freshUrl = await createAccountLink(freshId, origin)
        return NextResponse.redirect(freshUrl)
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        console.error('[stripe/connect] retry also failed:', retryMsg)
        return errorRedirect(retryMsg)
      }
    }

    return errorRedirect(linkMsg)
  }
}
