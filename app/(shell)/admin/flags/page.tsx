import { requireAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { FLAG_KEYS, FLAG_META } from '@/lib/flags-admin'
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

type FlagRow = {
  key: string
  enabled: boolean
  polarity: string | null
  description: string | null
  updated_at: string | null
  updated_by: string | null
}

const SORTS: readonly FlagSort[] = ['key_asc', 'key_desc', 'status', 'polarity', 'recent']
const STATUSES: readonly FlagStatusFilter[] = ['all', 'on', 'off']
const POLARITIES: readonly FlagPolarityFilter[] = ['all', 'killswitch', 'enablement']

/**
 * Admin control surface for the in-house feature flags (epic 09 · feature-flags-inhouse,
 * Sprint 2; filter/sort/pagination polish — admin-flags-cleanup fast-follow chore).
 * Clerk-gated read-only list here; the toggles POST to `/api/admin/flags`.
 *
 * The view UNIONS the known flags (`FLAG_KEYS`) with the live `platform_flags` rows so a
 * flag whose row is ABSENT still renders — an absent row means `isEnabled()` falls open to
 * its DEFAULT_FLAGS value (`FLAG_META[key].default`), which is exactly what we show, tagged
 * "por defecto" until it's first flipped (which inserts the row).
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

  let rows: FlagRow[] = []
  try {
    const { data } = await db
      .from('platform_flags')
      .select('key, enabled, polarity, description, updated_at, updated_by')
    rows = (data ?? []) as FlagRow[]
  } catch {
    // Non-fatal — the client can refresh; unknown rows fall back to defaults below.
  }

  const byKey = new Map(rows.map((r) => [r.key, r]))
  const allFlags: FlagView[] = FLAG_KEYS.map((key) => {
    const row = byKey.get(key)
    const meta = FLAG_META[key]
    return {
      key,
      polarity: meta.polarity,
      // Live value: the row's `enabled` when present, else the fail-open default.
      enabled: row ? row.enabled : meta.default,
      // `true` while no row exists yet (serving the DEFAULT_FLAGS value).
      isDefault: !row,
      description: row?.description ?? null,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    }
  })

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
        Prende y apaga funciones de la plataforma sin redeploy. Cada cambio queda en la Auditoría.
      </p>
      <p className="text-xs text-[var(--fg-muted)] mb-5">
        Los cambios tardan hasta ~60 s en aplicarse (caché en memoria). Si el almacén de flags no
        responde, cada función usa su valor por defecto (a prueba de fallos).
      </p>

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
