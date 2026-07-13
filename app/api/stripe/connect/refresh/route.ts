import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createAccountLink } from '@/lib/stripe'
import { resolveOrigin } from '@/lib/request-origin'

// GET — Stripe redirects here if the onboarding link expires (or the seller
// clicks "Completar configuración" from Pagos.tsx, which passes account_id
// explicitly); we generate a fresh onboarding link.
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const errorRedirect = (reason: string) =>
    NextResponse.redirect(
      new URL(`/shop/manage/settings?stripe=error&reason=${encodeURIComponent(reason)}`, req.url),
    )

  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.redirect(new URL('/shop/manage/settings', req.url))

  let origin: string
  try {
    origin = resolveOrigin({ siteUrl: process.env.NEXT_PUBLIC_SITE_URL, host: req.headers.get('host') })
  } catch (e) {
    return errorRedirect(e instanceof Error ? e.message : 'origin_unresolvable')
  }

  try {
    const url = await createAccountLink(accountId, origin)
    return NextResponse.redirect(url)
  } catch (e) {
    return errorRedirect(e instanceof Error ? e.message : 'account_link_failed')
  }
}
