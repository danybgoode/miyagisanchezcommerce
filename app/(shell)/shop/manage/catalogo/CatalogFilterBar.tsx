import Link from 'next/link'
import type { CatalogStatus } from '@/lib/catalog-status'
import { buildCatalogPageUrl, type CatalogSearchParams } from '@/lib/catalog-query'

/**
 * Zero-JS filter bar for `/shop/manage/catalogo` — a plain GET `<form>` (browser
 * handles the URL sync, same pattern as `app/(shell)/l/SearchBar.tsx`) plus a
 * status chip rail rendered as `Link`s (instant navigation, no submit needed).
 * Status lives outside the form, so a hidden input preserves it across a form
 * submit that changes the other filters.
 */
export default function CatalogFilterBar({
  params,
  categories,
  statusFilters,
  statusCounts,
}: {
  params: CatalogSearchParams
  categories: readonly { key: string; label: string; icon?: string }[]
  statusFilters: { value: CatalogStatus; label: string }[]
  statusCounts: Record<string, number>
}) {
  return (
    <div className="mb-4">
      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Link
          href={buildCatalogPageUrl({ ...params, status: undefined }, 1)}
          className={`badge no-underline ${!params.status ? 'badge-verified' : 'badge-soft'}`}
        >
          Todos
        </Link>
        {statusFilters.map((s) => (
          <Link
            key={s.value}
            href={buildCatalogPageUrl({ ...params, status: s.value }, 1)}
            className={`badge no-underline ${params.status === s.value ? 'badge-verified' : 'badge-soft'}`}
          >
            {s.label} ({statusCounts[s.value] ?? 0})
          </Link>
        ))}
      </div>

      {/* Search + structural filters */}
      <form method="GET" action="/shop/manage/catalogo" className="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="status" value={params.status ?? ''} />
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Buscar por título o SKU…"
          className="flex-1 min-w-[180px] border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm"
        />
        <select name="category" defaultValue={params.category ?? ''} className="border border-[var(--color-border)] rounded-[var(--r-md)] px-2 py-2 text-sm">
          <option value="">Toda categoría</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <select name="channel" defaultValue={params.channel ?? ''} className="border border-[var(--color-border)] rounded-[var(--r-md)] px-2 py-2 text-sm">
          <option value="">Todo canal</option>
          <option value="miyagi">Solo Miyagi</option>
          <option value="ml">+ Mercado Libre</option>
        </select>
        <select name="stock" defaultValue={params.stock ?? ''} className="border border-[var(--color-border)] rounded-[var(--r-md)] px-2 py-2 text-sm">
          <option value="">Todo inventario</option>
          <option value="in_stock">Con stock</option>
          <option value="agotado">Agotado</option>
          <option value="unlimited">Sin límite</option>
        </select>
        <select name="sort" defaultValue={params.sort ?? 'recent'} className="border border-[var(--color-border)] rounded-[var(--r-md)] px-2 py-2 text-sm">
          <option value="recent">Más reciente</option>
          <option value="title">Título A-Z</option>
          <option value="price_asc">Precio: menor a mayor</option>
          <option value="price_desc">Precio: mayor a menor</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">Filtrar</button>
      </form>
    </div>
  )
}
