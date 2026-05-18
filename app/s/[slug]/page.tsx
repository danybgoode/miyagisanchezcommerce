import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getShop, getShopListings, formatPrice } from '@/lib/listings'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) return { title: 'Tienda no encontrada' }
  return { title: shop.name }
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) notFound()
  const listings = await getShopListings(shop.id)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Shop header */}
      <div className="border border-[var(--color-border)] bg-white rounded p-5 mb-6 flex items-start gap-4">
        {shop.logo_url ? (
          <img src={shop.logo_url} alt={shop.name} className="w-16 h-16 rounded object-cover border border-[var(--color-border)]" />
        ) : (
          <div className="w-16 h-16 rounded bg-[var(--color-background)] border border-[var(--color-border)] flex items-center justify-center text-2xl">🏪</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[var(--color-text)]">{shop.name}</h1>
            {shop.verified && (
              <span className="text-xs bg-[var(--color-accent)] text-white px-2 py-0.5 rounded">Verificado</span>
            )}
            {!shop.clerk_user_id && (
              <span className="text-xs border border-amber-300 text-amber-700 bg-amber-50 px-2 py-0.5 rounded">No verificado</span>
            )}
          </div>
          {shop.location && <p className="text-sm text-[var(--color-muted)] mt-0.5">📍 {shop.location}</p>}
          {shop.description && <p className="text-sm text-[var(--color-text)] mt-2">{shop.description}</p>}
          {!shop.clerk_user_id && (
            <Link href={`/s/${slug}/claim`} className="inline-block mt-3 text-sm text-[var(--color-accent)] border border-[var(--color-accent)] rounded px-3 py-1 no-underline hover:bg-[var(--color-accent)] hover:text-white transition-colors">
              ¿Es tu tienda? Reclamar →
            </Link>
          )}
        </div>
        <p className="text-sm text-[var(--color-muted)] shrink-0">{listings.length} anuncios</p>
      </div>

      {/* Listings grid */}
      {listings.length === 0 ? (
        <p className="text-[var(--color-muted)] text-sm">Esta tienda aún no tiene anuncios.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {listings.map(listing => (
            <Link key={listing.id} href={`/l/${listing.id}`} className="no-underline">
              <div className="bg-white border border-[var(--color-border)] rounded hover:border-[var(--color-accent)] transition-colors">
                {listing.images?.[0] ? (
                  <img src={listing.images[0].url} alt={listing.title} className="w-full h-36 object-cover rounded-t" />
                ) : (
                  <div className="w-full h-36 bg-[var(--color-background)] flex items-center justify-center text-3xl rounded-t">📦</div>
                )}
                <div className="p-2">
                  <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2 leading-snug">{listing.title}</p>
                  <p className="text-sm font-bold text-[var(--color-accent)] mt-1">{formatPrice(listing)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
