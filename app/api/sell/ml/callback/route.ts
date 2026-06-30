import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { connectMlForSeller } from '@/lib/ml-connection'

/**
 * GET /api/sell/ml/callback — Mercado Libre OAuth redirect target.
 *
 * Validates the `state` cookie, then hands the authorization `code` to the
 * backend (`POST /internal/ml/connect`) which performs the token exchange and
 * stores the connection encrypted, keyed to the Medusa seller. The cleartext
 * tokens never transit the frontend. Redirects back to the status surface.
 */

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const statusUrl = new URL('/shop/manage/mercadolibre', req.url)

  if (!(await isEnabled('ml.connect_enabled'))) {
    return NextResponse.redirect(new URL('/shop/manage', req.url))
  }

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const storedState = req.cookies.get('ml_oauth_state')?.value

  const fail = (reason: string) => {
    statusUrl.searchParams.set('error', reason)
    const r = NextResponse.redirect(statusUrl)
    r.cookies.delete('ml_oauth_state')
    return r
  }

  if (!code || !state || state !== storedState) return fail('oauth_state')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.redirect(new URL('/sell', req.url))

  const result = await connectMlForSeller(shop.slug, code)
  if (!result.ok) return fail('oauth_failed')

  statusUrl.searchParams.set('connected', '1')
  const res = NextResponse.redirect(statusUrl)
  res.cookies.delete('ml_oauth_state')
  return res
}
