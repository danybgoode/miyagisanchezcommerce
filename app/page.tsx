import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getRecentListings, formatPrice, conditionLabel } from '@/lib/listings'
import CategoryChips from '@/app/components/CategoryChips'
import FavoriteButton from '@/app/components/FavoriteButton'
import { NEIGHBORHOOD_PULSE_COPY } from '@/lib/neighborhood-pulse'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `Hace ${days} día${days > 1 ? 's' : ''}`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  if (months < 12) return `Hace ${months} mes${months > 1 ? 'es' : ''}`
  return `Hace ${Math.floor(months / 12)} año${Math.floor(months / 12) > 1 ? 's' : ''}`
}

export default async function HomePage() {
  const [recent, user] = await Promise.all([getRecentListings(8), currentUser()])

  let favoritedIds = new Set<string>()
  if (user && recent.length > 0) {
    const ids = recent.map(l => l.id)
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

      {/* Recent listings */}
      {recent.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)' }}>
              Publicaciones recientes
            </h2>
            <Link href="/l" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
              Ver todo →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {recent.map(listing => (
              <div key={listing.id} style={{ position: 'relative' }}>
                <Link href={`/l/${listing.id}`} className="card-tile no-underline block">
                  {listing.images?.[0] ? (
                    <img
                      src={listing.images[0].url}
                      alt={listing.images[0].alt ?? listing.title}
                      className="w-full h-36 object-cover"
                    />
                  ) : (
                    <div className="w-full h-36 flex items-center justify-center" style={{ background: 'var(--bg-sunk)' }}>
                      <i className="iconoir-package" style={{ fontSize: 36, color: 'var(--fg-subtle)' }} />
                    </div>
                  )}
                  <div className="p-2">
                    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 4 }}>
                      {listing.title}
                    </p>
                    <p className="t-price" style={{ fontSize: 14 }}>{formatPrice(listing)}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                      {listing.condition && (
                        <span className="badge badge-soft" style={{ fontSize: 10 }}>
                          {conditionLabel(listing.condition)}
                        </span>
                      )}
                      {listing.location && (
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                          {listing.location}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 }}>
                      {listing.shop && (
                        <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {listing.shop.verified && <span style={{ color: 'var(--accent)' }}>✓ </span>}
                          {listing.shop.name}
                        </p>
                      )}
                      <p style={{ fontSize: 11, color: 'var(--fg-subtle)', flexShrink: 0, marginLeft: 4 }}>
                        {timeAgo(listing.created_at)}
                      </p>
                    </div>
                  </div>
                </Link>
                {/* Favorite overlay — top-right of the image */}
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
        </section>
      )}

      {recent.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--fg-muted)' }}>
          <i className="iconoir-shop" style={{ fontSize: 48, color: 'var(--fg-subtle)', display: 'block', marginBottom: 12 }} />
          <p style={{ fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>El marketplace está tomando forma</p>
          <p style={{ fontSize: 14 }}>Las primeras publicaciones aparecerán aquí pronto.</p>
        </div>
      )}
    </div>
  )
}
