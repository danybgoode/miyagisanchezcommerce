import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { randomBytes } from 'crypto'

/**
 * GET /api/sell/ml/connect — start the Mercado Libre OAuth dance.
 *
 * Ported (as reference) from despachobonsai's ml/connect route. Clerk-authed,
 * gated on `ml.connect_enabled` (dark-ship). Mints an OAuth `state`, stores it in
 * an httpOnly cookie, and redirects to ML's consent screen. Only the public app
 * id + redirect uri are used here — `ML_APP_SECRET` stays backend-only (the code
 * exchange happens in the Medusa module via /api/sell/ml/callback).
 */

const ML_AUTH_BASE = process.env.ML_AUTH_BASE ?? 'https://auth.mercadolibre.com.mx'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  // Dark-ship: the flag is OFF by default → there is nothing to connect yet.
  if (!(await isEnabled('ml.connect_enabled'))) {
    return NextResponse.redirect(new URL('/shop/manage', req.url))
  }

  const appId = process.env.ML_APP_ID
  const redirectUri = process.env.ML_REDIRECT_URI
  if (!appId || !redirectUri) {
    return NextResponse.redirect(new URL('/shop/manage/mercadolibre?error=ml_no_config', req.url))
  }

  // Confirm the caller owns a shop (the callback re-resolves the slug from the session).
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.redirect(new URL('/sell', req.url))

  const state = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appId,
    redirect_uri: redirectUri,
    state,
  })

  const res = NextResponse.redirect(`${ML_AUTH_BASE}/authorization?${params}`)
  res.cookies.set('ml_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
