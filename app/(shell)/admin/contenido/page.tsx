import { requireAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { getDictionary } from '@/lib/dictionary'
import { flattenDictionary } from '@/lib/copy-tree'
import { isBilingualNamespace } from '@/lib/bilingual-namespaces'
import {
  buildContenidoPageUrl,
  filterKeysByNamespace,
  filterKeysByQuery,
  filterKeysByStatus,
  paginate,
  sortKeys,
  type ContenidoSearchParams,
  type ContenidoSort,
  type ContenidoStatusFilter,
} from '@/lib/copy-overrides-admin-view'
import ContenidoAdminClient, { type OverrideKeyView, type OrphanOverrideView } from './ContenidoAdminClient'
import ContenidoImportExportPanel, { type KeyIndexEntry } from './ContenidoImportExportPanel'
import ContenidoFilterBar from './ContenidoFilterBar'
import ContenidoPagination from './ContenidoPagination'
import AnunciosAdminClient, { type AnnouncementView } from './AnunciosAdminClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contenido — Admin' }

const PAGE_SIZE = 20
const SORTS: readonly ContenidoSort[] = ['namespace_asc', 'recent']
const STATUSES: readonly ContenidoStatusFilter[] = ['all', 'overridden', 'default']

type OverrideRow = {
  namespace: string
  key: string
  locale: string
  value: string
  updated_at: string | null
  updated_by: string | null
}

type AnnouncementDbRow = {
  id: string
  audience: string
  text: string
  cta_label: string | null
  cta_link: string | null
  starts_at: string | null
  ends_at: string | null
  active: boolean
  updated_at: string | null
}

/**
 * Admin control surface for the runtime copy-override layer (epic 08 ·
 * admin-content-and-announcements, Sprint 1). Clerk-gated read-only list here;
 * saves/restores POST/DELETE `/api/admin/content-overrides`.
 *
 * The dictionary tree (via `getDictionary`, NOT the raw `locales/*.json`, NOT the
 * cached `getOverriddenDictionary`) is the "universe" every key is enumerated
 * from — the admin view always shows the LIVE, uncached override rows (a direct
 * `db` read, bypassing `lib/copy-overrides.ts`'s `unstable_cache`) so a save is
 * never shown stale to the person who just made it.
 */
export default async function AdminContenidoPage({
  searchParams,
}: {
  searchParams: Promise<ContenidoSearchParams>
}) {
  await requireAdmin()
  const params = await searchParams

  const esDict = await getDictionary('es')
  const enDict = await getDictionary('en')
  const esFlat = flattenDictionary(esDict)
  const enByPath = new Map(flattenDictionary(enDict).map((e) => [`${e.namespace}.${e.key}`, e.value]))
  const knownPaths = new Set(esFlat.map((e) => `${e.namespace}.${e.key}`))

  let overrideRows: OverrideRow[] = []
  try {
    const { data } = await db
      .from('platform_copy_overrides')
      .select('namespace, key, locale, value, updated_at, updated_by')
    overrideRows = (data ?? []) as OverrideRow[]
  } catch {
    // Non-fatal — the client can refresh; every key still renders its default.
  }

  const overridesByPath = new Map<string, OverrideRow[]>()
  for (const row of overrideRows) {
    const path = `${row.namespace}.${row.key}`
    const arr = overridesByPath.get(path) ?? []
    arr.push(row)
    overridesByPath.set(path, arr)
  }

  const keys: OverrideKeyView[] = esFlat.map((entry) => {
    const path = `${entry.namespace}.${entry.key}`
    const bilingual = isBilingualNamespace(entry.namespace)
    const rowsForPath = overridesByPath.get(path) ?? []
    const esOverride = rowsForPath.find((r) => r.locale === 'es') ?? null
    const enOverride = bilingual ? rowsForPath.find((r) => r.locale === 'en') ?? null : null

    return {
      namespace: entry.namespace,
      key: entry.key,
      bilingual,
      defaultEs: entry.value,
      defaultEn: bilingual ? enByPath.get(path) ?? null : null,
      overrideEs: esOverride?.value ?? null,
      overrideEn: enOverride?.value ?? null,
      updatedAt: esOverride?.updated_at ?? enOverride?.updated_at ?? null,
      updatedBy: esOverride?.updated_by ?? enOverride?.updated_by ?? null,
    }
  })

  // Orphaned overrides: a row whose namespace.key no longer resolves in the
  // current dictionary (the key was renamed/removed from locales/*.json since
  // it was last edited here). Flagged, not auto-deleted — «restaurar» cleans it up.
  const orphans: OrphanOverrideView[] = overrideRows
    .filter((r) => !knownPaths.has(`${r.namespace}.${r.key}`))
    .map((r) => ({ namespace: r.namespace, key: r.key, locale: r.locale, value: r.value }))

  // Same "always live, never stale to the admin who just saved" reasoning as the
  // override rows above — a direct, uncached `db` read (announcements.ts's
  // `unstable_cache` reader is for the public-facing render paths only).
  let announcementRows: AnnouncementDbRow[] = []
  try {
    const { data } = await db
      .from('platform_announcements')
      .select('id, audience, text, cta_label, cta_link, starts_at, ends_at, active, updated_at')
    announcementRows = (data ?? []) as AnnouncementDbRow[]
  } catch {
    // Non-fatal — the panel can refresh.
  }
  const announcements: AnnouncementView[] = announcementRows.map((r) => ({
    id: r.id,
    audience: r.audience === 'buyer' ? 'buyer' : 'seller',
    text: r.text,
    ctaLabel: r.cta_label,
    ctaLink: r.cta_link,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    active: r.active,
    updatedAt: r.updated_at,
  }))

  const namespaces = [...new Set(keys.map((k) => k.namespace))].sort()
  const keyIndex: KeyIndexEntry[] = keys.map((k) => ({ namespace: k.namespace, key: k.key }))

  const q = params.q ?? ''
  const namespace = namespaces.includes(params.namespace ?? '') ? (params.namespace as string) : 'all'
  const status: ContenidoStatusFilter = STATUSES.includes(params.status as ContenidoStatusFilter)
    ? (params.status as ContenidoStatusFilter)
    : 'all'
  const sort: ContenidoSort = SORTS.includes(params.sort as ContenidoSort) ? (params.sort as ContenidoSort) : 'namespace_asc'

  // Search + namespace narrow the set the status chips count against, so a
  // chip's count answers "how many would show if I also picked this" — the
  // status filter itself is applied AFTER (mirrors /admin/flags).
  const searched = filterKeysByNamespace(filterKeysByQuery(keys, q), namespace)
  const statusCounts = {
    all: searched.length,
    overridden: searched.filter((k) => k.overrideEs !== null || k.overrideEn !== null).length,
    default: searched.filter((k) => k.overrideEs === null && k.overrideEn === null).length,
  }

  const filtered = filterKeysByStatus(searched, status)
  const sorted = sortKeys(filtered, sort)
  const parsedPage = parseInt(params.page ?? '1', 10)
  const { pageItems, totalPages, page } = paginate(
    sorted,
    Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    PAGE_SIZE,
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: 'var(--fg)' }}>Contenido</h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: 14, margin: '0 0 8px' }}>
        Edita el copy de marketing ya publicado, sin deploy. Se ve en vivo en ≤1 min (o al instante, tras guardar).
      </p>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Solo se pueden editar claves que ya existen en el diccionario — «Original» siempre muestra el
        valor de fábrica. «Restaurar» borra el override y vuelve al valor de fábrica. Mientras escribes,
        verás «Antes» y «Después (borrador)» — la vista previa de cómo quedará antes de guardar.
      </p>

      <ContenidoImportExportPanel keyIndex={keyIndex} />

      <ContenidoFilterBar params={params} namespaces={namespaces} statusCounts={statusCounts} />

      <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 8px' }}>
        {filtered.length} de {keys.length} claves · página {page} de {totalPages}
      </p>

      <ContenidoPagination params={params} page={page} totalPages={totalPages} />

      <ContenidoAdminClient keys={pageItems} orphans={orphans} />

      <ContenidoPagination params={params} page={page} totalPages={totalPages} className="mt-4" />

      <AnunciosAdminClient announcements={announcements} />
    </div>
  )
}
