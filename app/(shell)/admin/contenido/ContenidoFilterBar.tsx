import Link from 'next/link'
import { buildContenidoPageUrl, type ContenidoSearchParams } from '@/lib/copy-overrides-admin-view'

/**
 * Zero-JS filter bar for `/admin/contenido` (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.1 — search/status/sort; Story
 * 3.1 — the namespace dropdown was superseded by the page-first nav column,
 * so `namespace`/`section` now ride as hidden inputs instead of a visible
 * `<select>`, preserving the active group across a search/sort submit).
 * Mirrors `FlagsFilterBar.tsx`: a status chip rail as `Link`s + a plain GET
 * `<form>`. Status lives outside the form, so a hidden input preserves it
 * across a form submit that changes the other filters.
 */
export default function ContenidoFilterBar({
  params,
  statusCounts,
}: {
  params: ContenidoSearchParams
  statusCounts: { all: number; overridden: number; default: number }
}) {
  return (
    <div className="mb-4">
      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Link
          href={buildContenidoPageUrl({ ...params, status: undefined }, 1)}
          className={`badge no-underline ${!params.status || params.status === 'all' ? 'badge-verified' : 'badge-soft'}`}
        >
          Todas ({statusCounts.all})
        </Link>
        <Link
          href={buildContenidoPageUrl({ ...params, status: 'overridden' }, 1)}
          className={`badge no-underline ${params.status === 'overridden' ? 'badge-verified' : 'badge-soft'}`}
        >
          Editadas ({statusCounts.overridden})
        </Link>
        <Link
          href={buildContenidoPageUrl({ ...params, status: 'default' }, 1)}
          className={`badge no-underline ${params.status === 'default' ? 'badge-verified' : 'badge-soft'}`}
        >
          Sin editar ({statusCounts.default})
        </Link>
      </div>

      {/* Search + namespace + sort */}
      <form method="GET" action="/admin/contenido" className="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="status" value={params.status ?? ''} />
        <input type="hidden" name="namespace" value={params.namespace ?? ''} />
        <input type="hidden" name="section" value={params.section ?? ''} />
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Buscar por clave o texto en esta página…"
          className="flex-1 min-w-[220px] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm"
        />
        <select
          name="sort"
          defaultValue={params.sort ?? 'namespace_asc'}
          className="border border-[var(--color-border)] rounded-lg px-2 py-2 text-sm"
        >
          <option value="namespace_asc">Página (A-Z)</option>
          <option value="recent">Editado recientemente</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">Filtrar</button>
      </form>
    </div>
  )
}
