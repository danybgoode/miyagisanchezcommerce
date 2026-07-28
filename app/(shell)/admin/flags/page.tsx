import { requireAdmin } from '@/lib/admin/guard'
import { GoldenFlagAdminUnavailable, getGoldenAdminSnapshot } from '@/lib/golden-flag-admin'
import {
  filterFlagsByPolarity,
  filterFlagsByQuery,
  filterFlagsByStatus,
  paginate,
  sortFlags,
  type FlagPolarityFilter,
  type FlagSort,
  type FlagStatusFilter,
  type FlagsSearchParams,
} from '@/lib/flags-admin-view'
import FlagsFilterBar from './FlagsFilterBar'
import FlagsPagination from './FlagsPagination'
import FlagsAdminClient, { type FlagView } from './FlagsAdminClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Flags — Admin' }

const PAGE_SIZE = 15

const SORTS: readonly FlagSort[] = ['key_asc', 'key_desc', 'status', 'polarity', 'recent']
const STATUSES: readonly FlagStatusFilter[] = ['all', 'on', 'off']
const POLARITIES: readonly FlagPolarityFilter[] = ['all', 'killswitch', 'enablement']

/**
 * Admin control surface for the in-house feature flags (epic 09 · feature-flags-inhouse,
 * Sprint 2; filter/sort/pagination polish — admin-flags-cleanup fast-follow chore).
 * Clerk-gated read-only list here; the toggles POST to `/api/admin/flags`.
 *
 * The view reads Golden's credential-scoped snapshot directly. Runtime `shadow` mode still keeps
 * Miyagi's local mirror authoritative, but this control surface intentionally has no local-value
 * fallback: showing an old local row here would recreate the second operational writer this story
 * removes.
 *
 * Filter/sort/pagination is URL-search-param-driven (mirrors `/shop/manage/catalogo`'s
 * pattern — `lib/catalog-query.ts` / `CatalogFilterBar.tsx`) rather than client-side state:
 * shareable/bookmarkable, survives a refresh, and keeps the client bundle down to just the
 * toggle-button interactivity.
 */
export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<FlagsSearchParams>
}) {
  await requireAdmin()
  const params = await searchParams

  let snapshot: Awaited<ReturnType<typeof getGoldenAdminSnapshot>> | null = null
  try {
    snapshot = await getGoldenAdminSnapshot()
  } catch (error) {
    if (!(error instanceof GoldenFlagAdminUnavailable)) throw error
  }

  // There is intentionally no platform_flags fallback here. In shadow mode the runtime's local
  // mirror remains authoritative, but this operational surface must show the Golden source of truth
  // rather than create a second writer or conceal a control-plane outage.
  const allFlags: FlagView[] = (snapshot?.flags ?? []).map((flag) => ({
    key: flag.key,
    polarity: flag.polarity,
    criticality: flag.criticality,
    enabled: flag.value,
    definitionVersion: flag.definitionVersion,
    reason: flag.reason,
    environment: snapshot!.environment,
    snapshotVersion: snapshot!.snapshotVersion,
    snapshotUpdatedAt: snapshot!.snapshotUpdatedAt,
    updated_at: snapshot!.snapshotUpdatedAt,
    description: flag.description,
  }))

  const q = params.q ?? ''
  const status: FlagStatusFilter = STATUSES.includes(params.status as FlagStatusFilter)
    ? (params.status as FlagStatusFilter)
    : 'all'
  const polarity: FlagPolarityFilter = POLARITIES.includes(params.polarity as FlagPolarityFilter)
    ? (params.polarity as FlagPolarityFilter)
    : 'all'
  const sort: FlagSort = SORTS.includes(params.sort as FlagSort) ? (params.sort as FlagSort) : 'key_asc'

  // Search + polarity narrow the set the status chips count against, so a chip's
  // count answers "how many would show if I also picked this" — the status
  // filter itself is applied AFTER, so the chips' own counts don't collapse
  // to whichever one is currently selected.
  const searched = filterFlagsByPolarity(filterFlagsByQuery(allFlags, q), polarity)
  const statusCounts = {
    all: searched.length,
    on: searched.filter((f) => f.enabled).length,
    off: searched.filter((f) => !f.enabled).length,
  }

  const filtered = filterFlagsByStatus(searched, status)
  const sorted = sortFlags(filtered, sort)
  const parsedPage = parseInt(params.page ?? '1', 10)
  const { pageItems, totalPages, page } = paginate(
    sorted,
    Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    PAGE_SIZE,
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Flags</h1>
      <p className="text-sm text-[var(--fg-muted)] mb-1">
        Control de Golden Beans para las funciones de la plataforma. Cada cambio crea una versión
        inmutable y queda auditado con su actor.
      </p>
      <p className="text-xs text-[var(--fg-muted)] mb-5">
        Entorno {snapshot?.environment ?? 'no disponible'} · snapshot v{snapshot?.snapshotVersion ?? '—'}
        {snapshot ? ' · fresca desde Golden' : ''}.
        Los consumidores actualizan dentro de su ventana acotada; durante shadow, la tabla local
        sigue siendo sólo el respaldo de runtime, no una segunda operación.
      </p>

      {!snapshot && (
        <p role="alert" className="text-sm text-red-700 mb-5">
          Golden no está disponible para leer u operar flags. No se muestra un valor local alterno.
        </p>
      )}

      <FlagsFilterBar params={params} statusCounts={statusCounts} />

      <p className="text-xs text-[var(--fg-muted)] mb-2">
        {filtered.length} de {allFlags.length} funciones · página {page} de {totalPages}
      </p>

      <FlagsPagination params={params} page={page} totalPages={totalPages} />

      <FlagsAdminClient flags={pageItems} />

      <FlagsPagination params={params} page={page} totalPages={totalPages} className="mt-4" />
    </div>
  )
}
