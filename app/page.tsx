import Link from 'next/link'
import { getRecentListings, formatPrice } from '@/lib/listings'

const CATEGORIES = [
  { label: 'Productos', value: 'product', icon: '📦' },
  { label: 'Servicios', value: 'service', icon: '🔧' },
  { label: 'Alquiler', value: 'rental', icon: '🔑' },
]

export default async function HomePage() {
  const recent = await getRecentListings(8)

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Search */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-4">
          ¿Qué estás buscando?
        </h1>
        <form action="/l" method="GET" className="flex gap-2 max-w-xl">
          <input
            name="q"
            type="search"
            placeholder="Buscar productos, servicios..."
            className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            className="bg-[var(--color-accent)] text-white px-5 py-2 rounded text-sm font-medium hover:bg-[var(--color-accent-hover)]"
          >
            Buscar
          </button>
        </form>
      </div>

      {/* Categories */}
      <div className="flex gap-3 mb-10">
        {CATEGORIES.map(cat => (
          <Link
            key={cat.value}
            href={`/l?type=${cat.value}`}
            className="border border-[var(--color-border)] bg-white rounded px-4 py-2 text-sm flex items-center gap-2 no-underline text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
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
            <h2 className="font-semibold text-[var(--color-text)]">Publicaciones recientes</h2>
            <Link href="/l" className="text-sm text-[var(--color-accent)]">Ver todo →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {recent.map(listing => (
              <Link
                key={listing.id}
                href={`/l/${listing.id}`}
                className="no-underline group"
              >
                <div className="bg-white border border-[var(--color-border)] rounded overflow-hidden hover:border-[var(--color-accent)] transition-colors">
                  {listing.images?.[0] ? (
                    <img
                      src={listing.images[0].url}
                      alt={listing.images[0].alt ?? listing.title}
                      className="w-full h-36 object-cover"
                    />
                  ) : (
                    <div className="w-full h-36 bg-[var(--color-background)] flex items-center justify-center text-3xl">
                      📦
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-xs text-[var(--color-text)] font-medium line-clamp-2 leading-snug">{listing.title}</p>
                    <p className="text-sm font-bold text-[var(--color-accent)] mt-1">{formatPrice(listing)}</p>
                    {listing.shop && (
                      <p className="text-xs text-[var(--color-muted)] mt-0.5 truncate">{listing.shop.name}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {recent.length === 0 && (
        <div className="text-center py-16 text-[var(--color-muted)]">
          <p className="text-4xl mb-3">🏪</p>
          <p className="font-medium text-[var(--color-text)] mb-1">El marketplace está tomando forma</p>
          <p className="text-sm">Las primeras publicaciones aparecerán aquí pronto.</p>
        </div>
      )}
    </div>
  )
}
