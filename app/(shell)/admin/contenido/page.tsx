import { requireAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { getDictionary } from '@/lib/dictionary'
import { flattenDictionary } from '@/lib/copy-tree'
import { isBilingualNamespace } from '@/lib/bilingual-namespaces'
import ContenidoAdminClient, { type OverrideKeyView, type OrphanOverrideView } from './ContenidoAdminClient'
import ContenidoImportExportPanel from './ContenidoImportExportPanel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contenido — Admin' }

type OverrideRow = {
  namespace: string
  key: string
  locale: string
  value: string
  updated_at: string | null
  updated_by: string | null
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
export default async function AdminContenidoPage() {
  await requireAdmin()

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

  return (
    <>
      <ContenidoImportExportPanel />
      <ContenidoAdminClient keys={keys} orphans={orphans} />
    </>
  )
}
