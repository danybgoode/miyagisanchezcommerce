import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { searchListings, formatPrice, conditionLabel } from '@/lib/listings'
import { db } from '@/lib/supabase'
import type { SearchParams } from '@/lib/types'
import SearchBar from './SearchBar'
import CategoryChips from '@/app/components/CategoryChips'
import FavoriteButton from '@/app/components/FavoriteButton'

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

export default async function ListingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params, user] = await Promise.all([searchParams, currentUser()])
  const { listings, total, page } = await searchListings(params)

  // Fetch user's favorited listing IDs for quick heart rendering
  let favoritedIds = new Set<string>()
  if (user && listings.length > 0) {
    const listingIds = listings.map(l => l.id)
    const { data: favs } = await db
      .from('marketplace_favorites')
      .select('marketplace_listings!inner(medusa_product_id)')
      .eq('clerk_user_id', user.id)
      .in('marketplace_listings.medusa_product_id', listingIds)
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
  const totalPages = Math.ceil(total / 24)

  function pageUrl(p: number) {
    const sp = new URLSearchParams(params as Record<string, string>)
    sp.set('page', String(p))
    return `/l?${sp.toString()}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <CategoryChips activeCategory={params.category} className="mb-5" />

      <SearchBar
        params={params}
        initialQ={params.q}
        initialCategory={params.category}
        initialState={params.state}
      />

      {/* Result count */}
      <div className="flex items-center justify-between mb-4">
        <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{total}</span> resultados
          {params.q && <> para <em>&ldquo;{params.q}&rdquo;</em></>}
        </p>
        {Object.values(params).some(Boolean) && (
          <Link href="/l" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }}
            className="hover:text-[var(--fg)]">
            × Limpiar filtros
          </Link>
        )}
      </div>

      {listings.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--fg-muted)' }}>
          <i className="iconoir-search" style={{ fontSize: 40, display: 'block', marginBottom: 12, color: 'var(--fg-subtle)' }} />
          <p style={{ fontWeight: 500, color: 'var(--fg)', marginBottom: 4 }}>Sin resultados</p>
          <p style={{ fontSize: 13 }}>Intenta con otros términos o revisa los filtros.</p>
        </div>
      ) : (
        <>
          {/* 2-col on mobile, 3 on tablet, 3 on desktop */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {listings.map(listing => (
              <div key={listing.id} style={{ position: 'relative' }}>
                <Link href={`/l/${listing.id}`} className="card-tile no-underline block">
                <div style={{ position: 'relative' }}>
                {listing.images?.[0] ? (
                  <img src={listing.images[0].url} alt={listing.title} className="w-full h-40 object-cover" style={listing.in_stock === false ? { opacity: 0.55 } : undefined} />
                ) : (
                  <div className="w-full h-40 flex items-center justify-center" style={{ background: 'var(--bg-sunk)' }}>
                    <i className="iconoir-package" style={{ fontSize: 40, color: 'var(--fg-subtle)' }} />
                  </div>
                )}
                {listing.in_stock === false && (
                  <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--danger)', borderRadius: 'var(--r-pill)', padding: '3px 8px' }}>
                    Agotado
                  </span>
                )}
                </div>
                <div className="p-3">
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 4 }}>
                    {listing.title}
                  </p>
                  <p className="t-price" style={{ fontSize: 15 }}>{formatPrice(listing)}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {listing.condition && (
                      <span className="badge badge-soft" style={{ fontSize: 10 }}>
                        {conditionLabel(listing.condition)}
                      </span>
                    )}
                    {listing.location && (
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                        {listing.location}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
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
                {/* Favorite button — absolute overlay top-right of image */}
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
              {page > 1 && (
                <Link href={pageUrl(page - 1)} className="btn btn-secondary btn-sm no-underline">
                  ← Anterior
                </Link>
              )}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, page - 2) + i
                return p <= totalPages ? (
                  <Link
                    key={p}
                    href={pageUrl(p)}
                    className={p === page ? 'btn btn-primary btn-sm no-underline' : 'btn btn-secondary btn-sm no-underline'}
                  >
                    {p}
                  </Link>
                ) : null
              })}
              {page < totalPages && (
                <Link href={pageUrl(page + 1)} className="btn btn-secondary btn-sm no-underline">
                  Siguiente →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
