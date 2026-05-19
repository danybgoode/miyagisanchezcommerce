import Link from 'next/link'
import { searchListings, formatPrice, conditionLabel } from '@/lib/listings'
import type { SearchParams } from '@/lib/types'
import SearchBar from './SearchBar'

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
  const params = await searchParams
  const { listings, total, page } = await searchListings(params)
  const totalPages = Math.ceil(total / 24)

  function pageUrl(p: number) {
    const sp = new URLSearchParams(params as Record<string, string>)
    sp.set('page', String(p))
    return `/l?${sp.toString()}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <SearchBar
        params={params}
        initialQ={params.q}
        initialCategory={params.category}
        initialState={params.state}
      />

      {/* Result count + clear filters */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--color-muted)]">
          <span className="font-semibold text-[var(--color-text)]">{total}</span> resultados
          {params.q && <> para <em>&ldquo;{params.q}&rdquo;</em></>}
        </p>
        {Object.values(params).some(Boolean) && (
          <Link href="/l" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
            × Limpiar filtros
          </Link>
        )}
      </div>

      {listings.length === 0 ? (
        <div className="py-16 text-center text-[var(--color-muted)]">
          <p className="text-3xl mb-2">🔍</p>
          <p>Sin resultados. Intenta con otros términos.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {listings.map(listing => (
              <Link key={listing.id} href={`/l/${listing.id}`} className="no-underline group">
                <div className="bg-white border border-[var(--color-border)] rounded hover:border-[var(--color-accent)] transition-colors">
                  {listing.images?.[0] ? (
                    <img src={listing.images[0].url} alt={listing.title} className="w-full h-44 object-cover rounded-t" />
                  ) : (
                    <div className="w-full h-44 bg-[var(--color-background)] flex items-center justify-center text-4xl rounded-t">📦</div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-medium text-[var(--color-text)] line-clamp-2 leading-snug mb-1">{listing.title}</p>
                    <p className="font-bold text-[var(--color-accent)]">{formatPrice(listing)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {listing.condition && (
                        <span className="text-xs bg-[var(--color-background)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
                          {conditionLabel(listing.condition)}
                        </span>
                      )}
                      {listing.location && (
                        <span className="text-xs text-[var(--color-muted)] truncate">{listing.location}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      {listing.shop && (
                        <p className="text-xs text-[var(--color-muted)] truncate">
                          {listing.shop.verified ? '✓ ' : ''}{listing.shop.name}
                        </p>
                      )}
                      <p className="text-xs text-[var(--color-muted)] shrink-0 ml-auto">
                        {timeAgo(listing.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex gap-1 justify-center">
              {page > 1 && <Link href={pageUrl(page - 1)} className="border border-[var(--color-border)] px-3 py-1.5 rounded text-sm no-underline text-[var(--color-muted)] hover:text-[var(--color-text)]">← Anterior</Link>}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, page - 2) + i
                return p <= totalPages ? (
                  <Link key={p} href={pageUrl(p)} className={`border px-3 py-1.5 rounded text-sm no-underline ${p === page ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>{p}</Link>
                ) : null
              })}
              {page < totalPages && <Link href={pageUrl(page + 1)} className="border border-[var(--color-border)] px-3 py-1.5 rounded text-sm no-underline text-[var(--color-muted)] hover:text-[var(--color-text)]">Siguiente →</Link>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
