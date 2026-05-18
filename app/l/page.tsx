import Link from 'next/link'
import { searchListings, formatPrice, conditionLabel } from '@/lib/listings'
import type { SearchParams } from '@/lib/types'

const CONDITIONS = [
  { value: 'new', label: 'Nuevo' },
  { value: 'like_new', label: 'Como nuevo' },
  { value: 'good', label: 'Buen estado' },
  { value: 'fair', label: 'Aceptable' },
  { value: 'parts', label: 'Para piezas' },
]

const TYPES = [
  { value: 'product', label: 'Productos' },
  { value: 'service', label: 'Servicios' },
  { value: 'rental', label: 'Alquiler' },
]

export default async function ListingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const { listings, total, page } = await searchListings(params)
  const totalPages = Math.ceil(total / 24)

  function pageUrl(p: number) {
    const sp = new URLSearchParams(params as Record<string, string>)
    sp.set('page', String(p))
    return `/l?${sp.toString()}`
  }

  function filterUrl(key: string, value: string) {
    const sp = new URLSearchParams(params as Record<string, string>)
    if (sp.get(key) === value) sp.delete(key)
    else sp.set(key, value)
    sp.delete('page')
    return `/l?${sp.toString()}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
      {/* ── Sidebar filters ── */}
      <aside className="w-52 shrink-0 hidden md:block">
        <form method="GET" action="/l">
          {/* Preserve active filters in hidden inputs */}
          {params.type && <input type="hidden" name="type" value={params.type} />}
          {params.condition && <input type="hidden" name="condition" value={params.condition} />}
          {params.min_price && <input type="hidden" name="min_price" value={params.min_price} />}
          {params.max_price && <input type="hidden" name="max_price" value={params.max_price} />}

          <div className="mb-4">
            <input
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Buscar..."
              className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <button type="submit" className="w-full bg-[var(--color-accent)] text-white py-1.5 rounded text-sm font-medium mb-5 hover:bg-[var(--color-accent-hover)]">
            Buscar
          </button>
        </form>

        <div className="space-y-5 text-sm">
          <div>
            <p className="font-semibold text-[var(--color-text)] mb-2">Categoría</p>
            {TYPES.map(t => (
              <Link key={t.value} href={filterUrl('type', t.value)}
                className={`block py-0.5 no-underline ${params.type === t.value ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
                {params.type === t.value ? '● ' : '○ '}{t.label}
              </Link>
            ))}
          </div>

          <div>
            <p className="font-semibold text-[var(--color-text)] mb-2">Condición</p>
            {CONDITIONS.map(c => (
              <Link key={c.value} href={filterUrl('condition', c.value)}
                className={`block py-0.5 no-underline ${params.condition === c.value ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
                {params.condition === c.value ? '☑ ' : '☐ '}{c.label}
              </Link>
            ))}
          </div>

          <div>
            <p className="font-semibold text-[var(--color-text)] mb-2">Precio</p>
            <form method="GET" action="/l" className="space-y-1.5">
              {params.q && <input type="hidden" name="q" value={params.q} />}
              {params.type && <input type="hidden" name="type" value={params.type} />}
              {params.condition && <input type="hidden" name="condition" value={params.condition} />}
              <input name="min_price" type="number" placeholder="Mín" defaultValue={params.min_price ?? ''}
                className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)]" />
              <input name="max_price" type="number" placeholder="Máx" defaultValue={params.max_price ?? ''}
                className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)]" />
              <button type="submit" className="w-full border border-[var(--color-border)] rounded py-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
                Aplicar
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── Results ── */}
      <div className="flex-1 min-w-0">
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
                      {listing.shop && (
                        <p className="text-xs text-[var(--color-muted)] mt-1 truncate">
                          {listing.shop.verified ? '✓ ' : ''}{listing.shop.name}
                        </p>
                      )}
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
    </div>
  )
}
