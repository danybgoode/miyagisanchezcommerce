/**
 * GET    /api/mp/connect            — start MercadoPago Marketplace OAuth for the current seller
 * DELETE /api/mp/connect            — disconnect the seller's MP account
 *
 * Mirrors /api/stripe/connect. Seller-direct payouts via MP split payments.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { buildMpAuthorizationUrl } from '@/lib/mercadopago-connect'
import { syncMedusaSellerProfile } from '@/lib/medusa-seller-sync'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const errorRedirect = (reason: string) =>
    NextResponse.redirect(new URL(`/shop/manage/settings?mp=error&reason=${encodeURIComponent(reason)}`, req.url))

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.redirect(new URL('/sell', req.url))

  // Strip any trailing slash so the redirect_uri byte-matches the value sent at
  // token exchange AND the one registered in the MP app (a mismatch → invalid_grant).
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`).replace(/\/+$/, '')

  try {
    const state = randomUUID()
    const url = buildMpAuthorizationUrl({ state, redirectUri: `${origin}/api/mp/connect/callback` })
    return NextResponse.redirect(url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mp/connect] failed to build auth URL:', msg)
    return errorRedirect(msg)
  }
}

export async function DELETE(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const nextSettings = { ...settings, mercadopago: { connected: false, enabled: false } }

  await db.from('marketplace_shops')
    .update({ metadata: { ...meta, settings: nextSettings } })
    .eq('id', shop.id)

  try {
    await syncMedusaSellerProfile(await getToken(), { metadata: { settings: nextSettings } })
  } catch (e) {
    console.error('[mp/connect] disconnect Medusa sync failed (non-fatal):', e)
  }

  return NextResponse.json({ ok: true })
}
