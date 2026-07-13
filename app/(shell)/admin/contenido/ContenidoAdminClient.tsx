'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { previewOverrideValue } from '@/lib/copy-overrides-preview'
import { NO_SINGLE_PAGE_LABEL } from '@/lib/copy-overrides-routes'
import { humanizeKeyPath } from '@/lib/copy-overrides-labels'
import { buildBatchApplyRows, removeAppliedDrafts, updateDraftLocale, type DraftEntry } from '@/lib/copy-overrides-draft-batch'
import type { NavNamespaceGroup } from '@/lib/copy-overrides-page-nav'
import ContenidoPageNav from './ContenidoPageNav'

/** One overridable dictionary leaf, as rendered on the admin surface. */
export type OverrideKeyView = {
  namespace: string
  key: string
  /** True only for namespaces on the bilingual allow-list (lib/bilingual-namespaces.ts). */
  bilingual: boolean
  defaultEs: string
  defaultEn: string | null
  overrideEs: string | null
  overrideEn: string | null
  updatedAt: string | null
  updatedBy: string | null
}

/** An override row whose namespace.key no longer resolves in the current dictionary. */
export type OrphanOverrideView = {
  namespace: string
  key: string
  locale: string
  value: string
}

type Locale = 'es' | 'en'

function pathOf(r: { namespace: string; key: string }): string {
  return `${r.namespace}.${r.key}`
}

const previewPaneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 8px',
  borderRadius: 'var(--r-xs)',
  fontSize: 12,
  wordBreak: 'break-word',
}

/**
 * `/admin/contenido` — the runtime copy-override editor (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.1 — search/filter/sort/pagination
 * moved server-side; Story 3.1 — page-first IA: the flat/nested-`<details>`
 * accordion became a `ContenidoPageNav` column + a flat field list for
 * whichever ONE page/section is selected, with labels derived from the key
 * path via `humanizeKeyPath` instead of a hand-curated map).
 * **Clerk-gated** — the same-origin fetch carries the session cookie.
 *
 * Receives only the CURRENT PAGE/SECTION's already-filtered/sorted/paginated
 * slice — `page.tsx` owns nav-group scoping + search/status/sort/pagination
 * (URL-search-param-driven). Editing + saving upserts a
 * `platform_copy_overrides` row (live within ≤1 min via cache TTL, or
 * instantly via on-demand revalidation); «restaurar» deletes the row,
 * reverting to the compile-time default. `en` inputs render ONLY for a
 * bilingual-allow-listed namespace (AGENTS rule #5).
 */
export default function ContenidoAdminClient({
  keys,
  orphans,
  groups,
  activeNamespace,
  activeSection,
  filterBar,
  pagination,
  resultsSummary,
}: {
  keys: OverrideKeyView[]
  orphans: OrphanOverrideView[]
  groups: NavNamespaceGroup[]
  activeNamespace: string
  activeSection: string
  filterBar: React.ReactNode
  pagination: React.ReactNode
  resultsSummary: string
}) {
  const router = useRouter()
  const [rows, setRows] = useState<OverrideKeyView[]>(keys)
  const [orphanRows, setOrphanRows] = useState<OrphanOverrideView[]>(orphans)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Keyed the SAME way as pathOf() (`namespace.key`) but carries namespace/key
  // explicitly (rather than re-splitting the path string) so a draft started
  // on one page/section survives navigating to another — batched save can
  // apply edits spanning multiple pages in one Guardar cambios (Story 3.2).
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({})
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)

  // Re-sync from fresh server props after a `router.refresh()` — e.g. the bulk
  // import/export panel (or a successful batched save) triggers one, so the
  // field list below doesn't keep showing pre-apply values until a manual reload.
  useEffect(() => setRows(keys), [keys])
  useEffect(() => setOrphanRows(orphans), [orphans])

  const dirtyPaths = Object.keys(drafts)

  // Warn on tab close/refresh while there are unsaved drafts — the in-app
  // page-nav guard (below) handles client-side navigation between groups.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyPaths.length === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirtyPaths.length])

  /** Blocks navigation via a confirm() when there are unsaved drafts; a no-op (always proceeds) otherwise. */
  function confirmDiscardIfDirty(): boolean {
    if (dirtyPaths.length === 0) return true
    return window.confirm('Tienes cambios sin guardar. ¿Salir de esta página sin guardarlos?')
  }

  const activeGroup = groups.find((g) => g.namespace === activeNamespace)
  const activeEntry = activeGroup?.sections.find((s) => s.section === activeSection)

  function draftValue(r: OverrideKeyView, locale: Locale): string {
    const d = drafts[pathOf(r)]
    if (d && d[locale] !== undefined) return d[locale]!
    if (locale === 'es') return r.overrideEs ?? r.defaultEs
    return r.overrideEn ?? r.defaultEn ?? ''
  }

  /**
   * Typing a value back to the live current value un-dirties that locale —
   * otherwise an edit-then-revert would still count toward the batched-save
   * bar/unsaved-changes guard (caught by cross-agent review on this PR).
   * `updateDraftLocale` (pure, unit-tested) decides whether to drop the whole
   * entry once neither locale is left dirty.
   */
  function setDraft(r: OverrideKeyView, locale: Locale, value: string) {
    const path = pathOf(r)
    setDrafts((prev) => {
      const updated = updateDraftLocale(prev[path], r.namespace, r.key, locale, value, currentValue(r, locale))
      const next = { ...prev }
      if (updated) next[path] = updated
      else delete next[path]
      return next
    })
  }

  /** The value currently live (saved override, or the compile-time default). */
  function currentValue(r: OverrideKeyView, locale: Locale): string {
    return locale === 'es' ? r.overrideEs ?? r.defaultEs : r.overrideEn ?? r.defaultEn ?? ''
  }

  function isDirty(r: OverrideKeyView, locale: Locale): boolean {
    return draftValue(r, locale) !== currentValue(r, locale)
  }

  /**
   * Before/after preview, resolved through `previewOverrideValue` — the SAME
   * `applyCopyOverrides`/`copy-tree` seam `getOverriddenDictionary()` reads
   * through in production (Story 1.3), not a raw string compare.
   */
  function preview(r: OverrideKeyView, locale: Locale): { before: string; after: string } {
    const defaultValue = locale === 'es' ? r.defaultEs : r.defaultEn ?? ''
    return {
      before: previewOverrideValue(r.namespace, r.key, locale, defaultValue, currentValue(r, locale)),
      after: previewOverrideValue(r.namespace, r.key, locale, defaultValue, draftValue(r, locale)),
    }
  }

  /**
   * Batched save (Story 3.2) — collects EVERY dirty draft (which may span
   * multiple pages/sections, since `drafts` persists across page-nav) into
   * one call to the EXISTING bulk-apply route
   * (`POST /api/admin/content-overrides/import/apply`), the same one the
   * import/export panel already uses. A partial failure leaves only the
   * rejected rows pending (named in the error text); full success clears
   * every draft and refreshes the server data so the visible page reflects
   * what was just saved.
   */
  async function saveAllDrafts() {
    const rowsToApply = buildBatchApplyRows(drafts)
    if (rowsToApply.length === 0) return
    setBatchBusy(true)
    setBatchError(null)
    try {
      const res = await fetch('/api/admin/content-overrides/import/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsToApply }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBatchError(data?.error ?? 'No se pudieron guardar los cambios.')
        return
      }
      const rejected: Array<{ namespace?: unknown; key?: unknown; error?: unknown }> = data.rejected ?? []
      if (rejected.length > 0) {
        setDrafts((prev) => removeAppliedDrafts(prev, rejected))
        const names = rejected.map((r) => `${String(r.namespace)}.${String(r.key)}`).join(', ')
        setBatchError(`Se guardaron ${data.applied ?? 0}. No se pudieron guardar: ${names}.`)
      } else {
        setDrafts({})
      }
      router.refresh()
    } catch {
      setBatchError('Error de red al guardar los cambios.')
    } finally {
      setBatchBusy(false)
    }
  }

  async function restore(r: OverrideKeyView, locale: Locale) {
    const busyKey = `${pathOf(r)}:${locale}`
    setBusyId(busyKey)
    setError(null)
    try {
      const res = await fetch('/api/admin/content-overrides', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: r.namespace, key: r.key, locale }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo restaurar.')
        return
      }
      setRows((prev) =>
        prev.map((row) =>
          pathOf(row) === pathOf(r)
            ? { ...row, overrideEs: locale === 'es' ? null : row.overrideEs, overrideEn: locale === 'en' ? null : row.overrideEn }
            : row,
        ),
      )
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[pathOf(r)]
        return next
      })
    } catch {
      setError('Error de red al restaurar.')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteOrphan(o: OrphanOverrideView) {
    const busyKey = `orphan:${o.namespace}.${o.key}:${o.locale}`
    setBusyId(busyKey)
    setError(null)
    try {
      const res = await fetch('/api/admin/content-overrides', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: o.namespace, key: o.key, locale: o.locale }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'No se pudo eliminar.')
        return
      }
      setOrphanRows((prev) => prev.filter((x) => !(x.namespace === o.namespace && x.key === o.key && x.locale === o.locale)))
    } catch {
      setError('Error de red al eliminar.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <ContenidoPageNav
        groups={groups}
        activeNamespace={activeNamespace}
        activeSection={activeSection}
        guard={confirmDiscardIfDirty}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Sticky so the "where am I editing" context survives scrolling past a long field list (Story 4.3). */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 4,
            background: 'var(--bg)',
            paddingTop: 4,
            paddingBottom: 12,
            marginBottom: 4,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="t-caption" style={{ color: 'var(--fg-muted)' }}>
            Contenido <span style={{ margin: '0 4px' }}>›</span> {activeGroup?.label ?? activeNamespace}
          </div>
          <h2 className="t-h3" style={{ margin: '2px 0 0', color: 'var(--fg)' }}>
            {activeEntry?.route ? activeEntry.route.label : `${activeSection || activeNamespace} — ${NO_SINGLE_PAGE_LABEL}`}
          </h2>
          {activeEntry?.route && (
            <div className="badge-mono" style={{ marginTop: 4, display: 'inline-block' }}>
              {activeEntry.route.path}
            </div>
          )}
        </div>

        {filterBar}

        <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 8px' }}>{resultsSummary}</p>

        {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '0 0 16px' }}>{error}</p>}

        {rows.length === 0 && (
          <p style={{ color: 'var(--fg-muted)', fontSize: 14, padding: '16px 0' }}>
            Ninguna clave coincide con estos filtros en esta página.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => {
            const path = pathOf(r)
            const hasOverrideEs = r.overrideEs !== null
            const hasOverrideEn = r.overrideEn !== null
            const busyEs = busyId === `${path}:es`
            const busyEn = busyId === `${path}:en`
            return (
              <div key={path} className="card-panel" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <h3 className="t-h4" style={{ margin: 0, color: 'var(--fg)' }}>
                    {humanizeKeyPath(r.key)}
                  </h3>
                  <span className="badge-mono">{r.key}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 10px' }}>Original: {r.defaultEs}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <textarea
                    rows={2}
                    value={draftValue(r, 'es')}
                    onChange={(e) => setDraft(r, 'es', e.target.value)}
                    className="input"
                    style={{ flex: 1, resize: 'vertical' }}
                  />
                  {hasOverrideEs && (
                    <button onClick={() => restore(r, 'es')} disabled={busyEs} className="btn btn-secondary btn-sm">
                      {busyEs ? '…' : 'Restaurar'}
                    </button>
                  )}
                </div>
                {hasOverrideEs && (
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                    editado{r.updatedBy ? ` por ${r.updatedBy}` : ''}
                  </div>
                )}
                {isDirty(r, 'es') &&
                  (() => {
                    const { before, after } = preview(r, 'es')
                    return (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)' }}>● Cambios sin guardar</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <div style={{ ...previewPaneStyle, background: 'var(--bg-sunk)' }}>
                            <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Antes</div>
                            <div style={{ color: 'var(--fg-muted)' }}>{before}</div>
                          </div>
                          <div style={{ ...previewPaneStyle, background: 'var(--info-soft)' }}>
                            <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Después (borrador)</div>
                            <div style={{ color: 'var(--fg)' }}>{after}</div>
                          </div>
                        </div>
                        {activeEntry?.route && (
                          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                            Se aplicará en <span className="badge-mono">{activeEntry.route.path}</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                {r.bilingual && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)', paddingTop: 8 }}>EN</span>
                    <textarea
                      rows={2}
                      value={draftValue(r, 'en')}
                      onChange={(e) => setDraft(r, 'en', e.target.value)}
                      className="input"
                      style={{ flex: 1, resize: 'vertical' }}
                    />
                    {hasOverrideEn && (
                      <button onClick={() => restore(r, 'en')} disabled={busyEn} className="btn btn-secondary btn-sm">
                        {busyEn ? '…' : 'Restaurar'}
                      </button>
                    )}
                  </div>
                )}
                {r.bilingual &&
                  isDirty(r, 'en') &&
                  (() => {
                    const { before, after } = preview(r, 'en')
                    return (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)' }}>● Cambios sin guardar (EN)</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <div style={{ ...previewPaneStyle, background: 'var(--bg-sunk)' }}>
                            <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Antes</div>
                            <div style={{ color: 'var(--fg-muted)' }}>{before}</div>
                          </div>
                          <div style={{ ...previewPaneStyle, background: 'var(--info-soft)' }}>
                            <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Después (borrador)</div>
                            <div style={{ color: 'var(--fg)' }}>{after}</div>
                          </div>
                        </div>
                        {activeEntry?.route && (
                          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                            Se aplicará en <span className="badge-mono">{activeEntry.route.path}</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
              </div>
            )
          })}
        </div>

        {dirtyPaths.length > 0 && (
          <div
            className="card-panel"
            style={{
              position: 'sticky',
              bottom: 16,
              marginTop: 16,
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              boxShadow: 'var(--shadow-2)',
              zIndex: 5,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)' }}>
                Cambios sin guardar ({dirtyPaths.length})
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                Puede incluir ediciones de otras páginas que aún no has guardado.
              </div>
              {batchError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{batchError}</div>}
            </div>
            <button onClick={saveAllDrafts} disabled={batchBusy} className="btn btn-primary btn-sm">
              {batchBusy ? '…' : 'Guardar cambios'}
            </button>
          </div>
        )}

        {pagination}

        {orphanRows.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 className="t-h4" style={{ color: 'var(--fg)' }}>Overrides huérfanos</h2>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 8px' }}>
              Estas claves ya no existen en el diccionario (se renombraron o se borraron en el código).
              No afectan nada — puedes eliminarlas para limpiar.
            </p>
            {orphanRows.map((o) => {
              const busyKey = `orphan:${o.namespace}.${o.key}:${o.locale}`
              return (
                <div
                  key={busyKey}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <span className="badge-mono" style={{ flex: 1 }}>
                    {o.namespace}.{o.key} ({o.locale}): {o.value}
                  </span>
                  <button onClick={() => deleteOrphan(o)} disabled={busyId === busyKey} className="btn btn-secondary btn-sm">
                    {busyId === busyKey ? '…' : 'Eliminar'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
