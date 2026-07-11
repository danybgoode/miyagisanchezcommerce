import Link from 'next/link'
import { buildFlagsPageUrl, type FlagsSearchParams } from '@/lib/flags-admin-view'

/**
 * Zero-JS filter bar for `/admin/flags` — mirrors `CatalogFilterBar.tsx`'s shape
 * exactly (a status chip rail as `Link`s + a plain GET `<form>` for search/polarity/
 * sort), the established pattern for this repo's server-filtered admin tables. Status
 * lives outside the form, so a hidden input preserves it across a form submit that
 * changes the other filters.
 */
export default function FlagsFilterBar({
  params,
  statusCounts,
}: {
  params: FlagsSearchParams
  statusCounts: { all: number; on: number; off: number }
}) {
  return (
    <div className="mb-4">
      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Link
          href={buildFlagsPageUrl({ ...params, status: undefined }, 1)}
          className={`badge no-underline ${!params.status || params.status === 'all' ? 'badge-verified' : 'badge-soft'}`}
        >
          Todas ({statusCounts.all})
        </Link>
        <Link
          href={buildFlagsPageUrl({ ...params, status: 'on' }, 1)}
          className={`badge no-underline ${params.status === 'on' ? 'badge-verified' : 'badge-soft'}`}
        >
          Activas ({statusCounts.on})
        </Link>
        <Link
          href={buildFlagsPageUrl({ ...params, status: 'off' }, 1)}
          className={`badge no-underline ${params.status === 'off' ? 'badge-verified' : 'badge-soft'}`}
        >
          Apagadas ({statusCounts.off})
        </Link>
      </div>

      {/* Search + polarity + sort */}
      <form method="GET" action="/admin/flags" className="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="status" value={params.status ?? ''} />
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Buscar por nombre o descripción…"
          className="flex-1 min-w-[220px] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm"
        />
        <select
          name="polarity"
          defaultValue={params.polarity ?? ''}
          className="border border-[var(--color-border)] rounded-lg px-2 py-2 text-sm"
        >
          <option value="">Todo tipo</option>
          <option value="killswitch">Kill-switch</option>
          <option value="enablement">Activación</option>
        </select>
        <select
          name="sort"
          defaultValue={params.sort ?? 'key_asc'}
          className="border border-[var(--color-border)] rounded-lg px-2 py-2 text-sm"
        >
          <option value="key_asc">Nombre A-Z</option>
          <option value="key_desc">Nombre Z-A</option>
          <option value="status">Activas primero</option>
          <option value="polarity">Tipo (kill-switch primero)</option>
          <option value="recent">Cambiado recientemente</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">Filtrar</button>
      </form>
    </div>
  )
}
