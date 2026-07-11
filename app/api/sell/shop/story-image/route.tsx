import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getShopListings } from '@/lib/listings'
import { PLATFORM_OG_COLORS } from '@/lib/platform-theme'

/**
 * GET /api/sell/shop/story-image
 *
 * "Para tu historia" — a downloadable, vertical (Instagram-Story-ratio) share
 * image for the current seller's own shop (onboarding three-doors Sprint 3 ·
 * Story 3.2). Follows the same `ImageResponse` pattern as
 * app/(shell)/vende/_components/SellerAcquisitionOgImage.tsx and
 * app/api/splash/route.tsx — server-rendered, no canvas, no new dependency.
 * Seller-scoped: reads the caller's OWN shop from Clerk auth, never an
 * arbitrary slug param (nothing here is guessable/leakable to other sellers).
 */
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug, name, logo_url, location')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const listings = await getShopListings(shop.slug)
  const colors = PLATFORM_OG_COLORS
  const width = 1080
  const height = 1920

  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          background: `linear-gradient(160deg, ${colors.paper} 0%, ${colors.sunk} 100%)`,
          color: colors.ink,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '120px 90px',
        }}
      >
        {shop.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shop.logo_url}
            width={220}
            height={220}
            alt=""
            style={{ borderRadius: 32, objectFit: 'cover', marginBottom: 48 }}
          />
        ) : (
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: 32,
              background: colors.accent,
              color: colors.accentForeground,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 88,
              fontWeight: 800,
              marginBottom: 48,
            }}
          >
            {shop.name?.[0]?.toUpperCase() ?? 'M'}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, textAlign: 'center' }}>{shop.name}</div>
        <div style={{ display: 'flex', fontSize: 36, color: colors.muted, marginTop: 20, textAlign: 'center' }}>
          {listings.length} producto{listings.length === 1 ? '' : 's'}
          {shop.location ? ` · ${shop.location}` : ''}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 64,
            background: colors.accent,
            color: colors.accentForeground,
            padding: '20px 40px',
            borderRadius: 999,
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          miyagisanchez.com/s/{shop.slug}
        </div>
      </div>
    ),
    { width, height },
  )
}
