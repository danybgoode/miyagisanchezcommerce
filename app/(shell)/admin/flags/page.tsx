import { requireAdmin } from '@/lib/admin/guard'
import { Banner } from '@/components/feedback/Banner'
import { readGoldenFlagSnapshot } from '@/lib/golden-flag-provider'
import {
  GOLDEN_FLAG_CONSOLE_URL,
  catalogKeysMissingFromSnapshot,
  mirrorRowsFromSnapshot,
  type FlagView,
} from '@/lib/flags-mirror-view'
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
import FlagsMirrorTable from './FlagsMirrorTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Flags — Admin' }

const PAGE_SIZE = 15

const SORTS: readonly FlagSort[] = ['key_asc', 'key_desc', 'status', 'polarity', 'recent']
const STATUSES: readonly FlagStatusFilter[] = ['all', 'on', 'off']
const POLARITIES: readonly FlagPolarityFilter[] = ['all', 'killswitch', 'enablement']

/**
 * `/admin/flags` — a READ-ONLY MIRROR of Golden Frijoles (flag-provider-mandate S2.1, D5).
 *
 * It renders the snapshot the runtime is serving — same credential, same provider as `isEnabled()`
 * — and links out to Golden's console, which is the ONLY place a flag can change. It used to be a
 * second writer onto a retired legacy catalog: two windows, one of which decided nothing, and the
 * product owner "0% sure where to manage anything". There is deliberately no toggle, no write route,
 * and no local-value fallback: when Golden is unavailable the page says so and shows nothing,
 * because an old value here would be a confident falsehood.
 *
 * Filter/sort/pagination stays URL-search-param-driven (shareable, survives refresh).
 */
export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<FlagsSearchParams>
}) {
  await requireAdmin()
  const params = await searchParams

  const snapshot = await readGoldenFlagSnapshot()
  const allFlags: FlagView[] = snapshot ? mirrorRowsFromSnapshot(snapshot) : []
  const missing = snapshot ? catalogKeysMissingFromSnapshot(snapshot) : []

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
      <div data-testid="flags-readonly-mirror" className="mb-4">
        <Banner variant="info" title="Espejo de sólo lectura de Golden Frijoles">
          Aquí ves lo que producción está sirviendo. Las flags se cambian únicamente en la consola de
          Golden:{' '}
          <a
            href={GOLDEN_FLAG_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium"
          >
            abrir flags de miyagisanchez en Golden ↗
          </a>
        </Banner>
      </div>
      <p className="text-xs text-[var(--fg-muted)] mb-5">
        Entorno {snapshot?.environment ?? 'no disponible'} · snapshot v{snapshot?.snapshotVersion ?? '—'}
        {snapshot ? ' · la misma lectura que usa el runtime' : ''}.
      </p>

      {!snapshot && (
        <p role="alert" className="text-sm text-red-700 mb-5">
          Golden no está disponible para leer flags. No se muestra un valor local alterno.
        </p>
      )}

      {missing.length > 0 && (
        <p role="alert" className="text-sm text-red-700 mb-5">
          {missing.length} flag(s) de este build no existen en Golden y usan su valor por defecto:{' '}
          <span className="font-mono">{missing.join(', ')}</span>
        </p>
      )}

      <FlagsFilterBar params={params} statusCounts={statusCounts} />

      <p className="text-xs text-[var(--fg-muted)] mb-2">
        {filtered.length} de {allFlags.length} funciones · página {page} de {totalPages}
      </p>

      <FlagsPagination params={params} page={page} totalPages={totalPages} />

      <FlagsMirrorTable flags={pageItems} />

      <FlagsPagination params={params} page={page} totalPages={totalPages} className="mt-4" />
    </div>
  )
}
