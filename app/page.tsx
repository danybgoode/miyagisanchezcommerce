import Link from 'next/link'
import { getRecentListings, formatPrice } from '@/lib/listings'
import { CATEGORIES } from '@/lib/types'

export default async function HomePage() {
  const recent = await getRecentListings(8)

  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      {/* Category chips — horizontal scroll on mobile */}
      <div className="chip-rail mb-6">
        {CATEGORIES.map(cat => (
          <Link
            key={cat.key}
            href={`/l?category=${cat.key}`}
            className="chip"
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </Link>
        ))}
      </div>

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
              <Link key={listing.id} href={`/l/${listing.id}`} className="card-tile no-underline">
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
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {listing.title}
                  </p>
                  <p className="t-price" style={{ fontSize: 14, marginTop: 4 }}>{formatPrice(listing)}</p>
                  {listing.shop && (
                    <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {listing.shop.name}
                    </p>
                  )}
                </div>
              </Link>
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
