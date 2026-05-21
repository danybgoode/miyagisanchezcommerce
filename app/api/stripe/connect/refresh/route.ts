import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createAccountLink } from '@/lib/stripe'

// GET — Stripe redirects here if the onboarding link expires; we generate a fresh one
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.redirect(new URL('/shop/manage/settings', req.url))

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`
  const url = await createAccountLink(accountId, origin)
  return NextResponse.redirect(url)
}
