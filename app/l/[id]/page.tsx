import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getListing, formatPrice, conditionLabel } from '@/lib/listings'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) return { title: 'Anuncio no encontrado' }
  return { title: listing.title, description: listing.description ?? undefined }
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) notFound()

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <nav className="text-sm text-[var(--color-muted)] mb-4">
        <Link href="/" className="hover:text-[var(--color-text)]">Inicio</Link>
        {' › '}
        <Link href="/l" className="hover:text-[var(--color-text)]">Anuncios</Link>
        {' › '}
        <span className="text-[var(--color-text)]">{listing.title}</span>
      </nav>

      <div className="grid md:grid-cols-5 gap-8">
        {/* Images */}
        <div className="md:col-span-3">
          {listing.images?.[0] ? (
            <img src={listing.images[0].url} alt={listing.title} className="w-full rounded border border-[var(--color-border)]" />
          ) : (
            <div className="w-full aspect-video bg-[var(--color-background)] border border-[var(--color-border)] rounded flex items-center justify-center text-5xl">📦</div>
          )}
          {listing.images.length > 1 && (
            <div className="flex gap-2 mt-2">
              {listing.images.slice(1).map((img, i) => (
                <img key={i} src={img.url} alt={img.alt ?? ''} className="w-16 h-16 object-cover rounded border border-[var(--color-border)]" />
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="md:col-span-2">
          <h1 className="text-xl font-bold text-[var(--color-text)] mb-2">{listing.title}</h1>
          <p className="text-2xl font-bold text-[var(--color-accent)] mb-4">{formatPrice(listing)}</p>

          <dl className="space-y-2 text-sm mb-6">
            {listing.condition && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-muted)] w-24 shrink-0">Condición</dt>
                <dd className="font-medium">{conditionLabel(listing.condition)}</dd>
              </div>
            )}
            {listing.location && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-muted)] w-24 shrink-0">Ubicación</dt>
                <dd>{listing.location}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted)] w-24 shrink-0">Tipo</dt>
              <dd className="capitalize">{listing.listing_type}</dd>
            </div>
            {listing.source_platform && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-muted)] w-24 shrink-0">Fuente</dt>
                <dd className="capitalize text-[var(--color-muted)]">{listing.source_platform}</dd>
              </div>
            )}
          </dl>

          {listing.shop && (
            <div className="border border-[var(--color-border)] rounded p-3 mb-4">
              <p className="text-xs text-[var(--color-muted)] mb-1">Vendedor</p>
              <Link href={`/s/${listing.shop.slug}`} className="font-semibold text-sm no-underline text-[var(--color-text)] hover:text-[var(--color-accent)]">
                {listing.shop.verified && <span className="text-[var(--color-accent)] mr-1">✓</span>}
                {listing.shop.name}
              </Link>
              {listing.shop.location && <p className="text-xs text-[var(--color-muted)] mt-0.5">{listing.shop.location}</p>}
              {!listing.shop.clerk_user_id && (
                <Link href={`/s/${listing.shop.slug}/claim`} className="text-xs text-[var(--color-accent)] mt-1 block">
                  ¿Es tu tienda? Reclamar →
                </Link>
              )}
            </div>
          )}

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {listing.tags.map(tag => (
                <Link key={tag} href={`/l?q=${encodeURIComponent(tag)}`}
                  className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 text-[var(--color-muted)] no-underline hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                  {tag}
                </Link>
              ))}
            </div>
          )}

          <p className="text-xs text-[var(--color-muted)]">{listing.views} vistas</p>
        </div>
      </div>

      {listing.description && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-6">
          <h2 className="font-semibold mb-3">Descripción</h2>
          <p className="text-sm text-[var(--color-text)] whitespace-pre-line leading-relaxed">{listing.description}</p>
        </div>
      )}
    </div>
  )
}
