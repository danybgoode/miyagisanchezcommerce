import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  getFeaturedListing,
  getCuratedListings,
  getCategoryCounts,
  formatPrice,
  conditionLabel,
} from '@/lib/listings'
import { isRecentForBadge } from '@/lib/home-curation'
import type { Listing } from '@/lib/types'
import CategoryChips from '@/app/components/CategoryChips'
import FavoriteButton from '@/app/components/FavoriteButton'
import { NEIGHBORHOOD_PULSE_COPY } from '@/lib/neighborhood-pulse'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  return `Hace ${hrs} h`
}

export default async function HomePage() {
  const [featured, grid, categories, user] = await Promise.all([
    getFeaturedListing(),
    getCuratedListings(4),
    getCategoryCounts(),
    currentUser(),
  ])

  const seleccion: Listing[] = [...(featured ? [featured] : []), ...grid]

  let favoritedIds = new Set<string>()
  if (user && seleccion.length > 0) {
    const ids = seleccion.map(l => l.id)
    const { data: favs } = await db
      .from('marketplace_favorites')
      .select('marketplace_listings!inner(medusa_product_id)')
      .eq('clerk_user_id', user.id)
      .in('marketplace_listings.medusa_product_id', ids)
    favoritedIds = new Set(
      (favs ?? [])
        .map(f => {
          const listing = f.marketplace_listings as unknown as { medusa_product_id?: string | null } | { medusa_product_id?: string | null }[]
          return Array.isArray(listing) ? listing[0]?.medusa_product_id : listing?.medusa_product_id
        })
        .filter((id): id is string => !!id),
    )
  }
  const isSignedIn = !!user
  const now = Date.now()

  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      <CategoryChips className="mb-6" />

      {/* Vecindario entry — keeps the community feed reachable after it left the tab bar */}
      <Link
        href="/vecindario"
        data-testid="vecindario-feed-entry"
        className="card-tile no-underline block mb-6"
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-sunk)',
          }}
        >
          <i className="iconoir-community" style={{ fontSize: 24, color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
            {NEIGHBORHOOD_PULSE_COPY.eyebrow}
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>
            {NEIGHBORHOOD_PULSE_COPY.navLabel}
          </p>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {NEIGHBORHOOD_PULSE_COPY.intro}
          </p>
        </div>
        <span style={{ flexShrink: 0, fontSize: 13, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
          {NEIGHBORHOOD_PULSE_COPY.viewFeedCta} →
        </span>
      </Link>

      {/* Selección de la semana — a curated pick + grid, price as the loudest element */}
      {seleccion.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)' }}>
              Selección de la semana
            </h2>
            <Link href="/l" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
              Ver todo →
            </Link>
          </div>

          {/* Featured card — full-width 16:9, price 18px loudest */}
          {featured && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Link href={`/l/${featured.id}`} className="card-tile no-underline block">
                <div style={{ position: 'relative' }}>
                  {featured.images?.[0] ? (
                    <img
                      src={featured.images[0].url}
                      alt={featured.images[0].alt ?? featured.title}
                      className="w-full object-cover"
                      style={{ aspectRatio: '16 / 9' }}
                    />
                  ) : (
                    <div className="w-full flex items-center justify-center" style={{ aspectRatio: '16 / 9', background: 'var(--bg-sunk)' }}>
                      <i className="iconoir-package" style={{ fontSize: 48, color: 'var(--fg-subtle)' }} />
                    </div>
                  )}
                  <span
                    className="badge"
                    style={{ position: 'absolute', top: 10, left: 10, fontSize: 11, fontWeight: 600, background: 'var(--accent)', color: 'var(--fg-inverse)' }}
                  >
                    Destacado
                  </span>
                </div>
                <div className="p-3">
                  <p className="t-price" style={{ fontSize: 18, fontWeight: 600 }}>{formatPrice(featured)}</p>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', margin: '4px 0' }}>
                    {featured.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
                    {featured.location && <span>{featured.location}</span>}
                    {featured.location && featured.shop && <span style={{ color: 'var(--fg-subtle)' }}>·</span>}
                    {featured.shop && (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {featured.shop.verified && <i className="iconoir-badge-check" style={{ color: 'var(--accent)', marginRight: 3, verticalAlign: 'middle' }} aria-hidden />}
                        {featured.shop.name}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}>
                <FavoriteButton
                  listingId={featured.id}
                  initialFavorited={favoritedIds.has(featured.id)}
                  isSignedIn={isSignedIn}
                  size="sm"
                />
              </div>
            </div>
          )}

          {/* Grid — price 16px loudest, ONE meta line, <48h timestamp badge */}
          {grid.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {grid.map(listing => (
                <div key={listing.id} style={{ position: 'relative' }}>
                  <Link href={`/l/${listing.id}`} className="card-tile no-underline block">
                    <div style={{ position: 'relative' }}>
                      {listing.images?.[0] ? (
                        <img
                          src={listing.images[0].url}
                          alt={listing.images[0].alt ?? listing.title}
                          className="w-full object-cover"
                          style={{ aspectRatio: '1 / 1' }}
                        />
                      ) : (
                        <div className="w-full flex items-center justify-center" style={{ aspectRatio: '1 / 1', background: 'var(--bg-sunk)' }}>
                          <i className="iconoir-package" style={{ fontSize: 36, color: 'var(--fg-subtle)' }} />
                        </div>
                      )}
                      {isRecentForBadge(listing.created_at, now) && (
                        <span
                          className="badge badge-soft"
                          style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 10 }}
                        >
                          {timeAgo(listing.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="t-price" style={{ fontSize: 16, fontWeight: 600 }}>{formatPrice(listing)}</p>
                      <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', margin: '3px 0' }}>
                        {listing.title}
                      </p>
                      {(listing.location || listing.condition) && (
                        <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[listing.location, conditionLabel(listing.condition)].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </Link>
                  <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 5 }}>
                    <FavoriteButton
                      listingId={listing.id}
                      initialFavorited={favoritedIds.has(listing.id)}
                      isSignedIn={isSignedIn}
                      size="sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Categorías con vida — only categories with ≥1 active listing, with live counts */}
      {categories.length > 0 && (
        <section className="mb-8">
          <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)', marginBottom: 16 }}>
            Categorías
          </h2>
          <div className="card-tile" style={{ padding: 0, overflow: 'hidden' }}>
            {categories.map((cat, i) => (
              <Link
                key={cat.key}
                href={`/l?category=${cat.key}`}
                className="no-underline"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <i className={`iconoir-${cat.icon}`} style={{ fontSize: 17, color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
                <span style={{ flex: 1, fontSize: 13.5, color: 'var(--fg)' }}>{cat.label}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{cat.count}</span>
                <i className="iconoir-arrow-right" style={{ fontSize: 15, color: 'var(--fg-subtle)', flexShrink: 0 }} aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}

      {seleccion.length === 0 && categories.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--fg-muted)' }}>
          <i className="iconoir-shop" style={{ fontSize: 48, color: 'var(--fg-subtle)', display: 'block', marginBottom: 12 }} />
          <p style={{ fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>El marketplace está tomando forma</p>
          <p style={{ fontSize: 14 }}>Las primeras publicaciones aparecerán aquí pronto.</p>
        </div>
      )}
    </div>
  )
}
