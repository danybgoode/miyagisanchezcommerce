/**
 * GET /api/mp/connect/callback
 *
 * MercadoPago redirects here after the seller authorizes the marketplace app.
 * Exchanges the code for the seller's tokens and stores them in
 * marketplace_shops.metadata.settings.mercadopago (synced to the Medusa seller).
 *
 * Mirrors /api/stripe/connect/return.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { exchangeMpCode, mpSettingsFromToken, getShopMercadoPago } from '@/lib/mercadopago-connect'
import { syncMedusaSellerProfile } from '@/lib/medusa-seller-sync'

export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const errorRedirect = (reason: string) =>
    NextResponse.redirect(new URL(`/shop/manage/settings?mp=error&reason=${encodeURIComponent(reason)}`, req.url))

  const code = req.nextUrl.searchParams.get('code')
  const oauthError = req.nextUrl.searchParams.get('error')
  if (oauthError) return errorRedirect(oauthError)
  if (!code) return errorRedirect('missing_code')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.redirect(new URL('/sell', req.url))

  // Must byte-match the redirect_uri used at authorization AND registered in MP
  // (trailing slash → invalid_grant). Strip any trailing slash defensively.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`).replace(/\/+$/, '')
  const redirectUri = `${origin}/api/mp/connect/callback`

  try {
    const token = await exchangeMpCode({ code, redirectUri })

    const meta = (shop.metadata ?? {}) as Record<string, unknown>
    const settings = (meta.settings ?? {}) as Record<string, unknown>
    const prev = getShopMercadoPago(shop.metadata as Record<string, unknown> | null)
    const nextSettings = { ...settings, mercadopago: mpSettingsFromToken(token, prev) }

    await db.from('marketplace_shops')
      .update({ metadata: { ...meta, settings: nextSettings } })
      .eq('id', shop.id)

    try {
      await syncMedusaSellerProfile(await getToken(), { metadata: { settings: nextSettings } })
    } catch (e) {
      console.error('[mp/connect/callback] Medusa seller sync failed (non-fatal):', e)
    }

    return NextResponse.redirect(new URL('/shop/manage/settings?mp=connected', req.url))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mp/connect/callback] token exchange failed:', msg, 'redirect_uri=', redirectUri)
    // Surface MP's actual error (e.g. invalid_grant / invalid_client) for diagnosis.
    return errorRedirect(`exchange_failed: ${msg}`.slice(0, 350))
  }
}
