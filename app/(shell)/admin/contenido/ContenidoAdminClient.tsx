'use client'

import { useEffect, useMemo, useState } from 'react'
import { previewOverrideValue } from '@/lib/copy-overrides-preview'
import { routeForNamespaceSection, NO_SINGLE_PAGE_LABEL } from '@/lib/copy-overrides-routes'

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

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  background: 'var(--bg)',
  color: 'var(--fg)',
  resize: 'vertical',
}

const previewPaneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 12,
  wordBreak: 'break-word',
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

/**
 * `/admin/contenido` — the runtime copy-override editor (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.1 — search/filter/sort/pagination
 * moved server-side, mirrors `/admin/flags`'s `FlagsAdminClient` split).
 * **Clerk-gated** — the same-origin fetch carries the session cookie.
 *
 * Receives only the CURRENT PAGE's already-filtered/sorted slice — `page.tsx`
 * owns search/namespace/status/sort/pagination now (URL-search-param-driven).
 * Editing + saving upserts a `platform_copy_overrides` row (live within ≤1 min
 * via cache TTL, or instantly via on-demand revalidation); «restaurar» deletes
 * the row, reverting to the compile-time default. `en` inputs render ONLY for
 * a bilingual-allow-listed namespace (AGENTS rule #5).
 */
export default function ContenidoAdminClient({
  keys,
  orphans,
}: {
  keys: OverrideKeyView[]
  orphans: OrphanOverrideView[]
}) {
  const [rows, setRows] = useState<OverrideKeyView[]>(keys)
  const [orphanRows, setOrphanRows] = useState<OrphanOverrideView[]>(orphans)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<Locale, string>>>>({})

  // Re-sync from fresh server props after a `router.refresh()` — e.g. the bulk
  // import/export panel triggers one after applying a batch, so the per-key list
  // below doesn't keep showing pre-apply values until a manual reload.
  useEffect(() => setRows(keys), [keys])
  useEffect(() => setOrphanRows(orphans), [orphans])

  const grouped = useMemo(() => {
    const byNamespace = new Map<string, Map<string, OverrideKeyView[]>>()
    for (const r of rows) {
      const section = r.key.split('.')[0] ?? r.key
      if (!byNamespace.has(r.namespace)) byNamespace.set(r.namespace, new Map())
      const bySection = byNamespace.get(r.namespace)!
      if (!bySection.has(section)) bySection.set(section, [])
      bySection.get(section)!.push(r)
    }
    return byNamespace
  }, [rows])

  function draftValue(r: OverrideKeyView, locale: Locale): string {
    const d = drafts[pathOf(r)]
    if (d && d[locale] !== undefined) return d[locale]!
    if (locale === 'es') return r.overrideEs ?? r.defaultEs
    return r.overrideEn ?? r.defaultEn ?? ''
  }

  function setDraft(r: OverrideKeyView, locale: Locale, value: string) {
    const path = pathOf(r)
    setDrafts((prev) => ({ ...prev, [path]: { ...prev[path], [locale]: value } }))
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

  async function save(r: OverrideKeyView, locale: Locale) {
    const busyKey = `${pathOf(r)}:${locale}`
    const value = draftValue(r, locale)
    setBusyId(busyKey)
    setError(null)
    try {
      const res = await fetch('/api/admin/content-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: r.namespace, key: r.key, locale, value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo guardar.')
        return
      }
      setRows((prev) =>
        prev.map((row) =>
          pathOf(row) === pathOf(r)
            ? {
                ...row,
                overrideEs: locale === 'es' ? value : row.overrideEs,
                overrideEn: locale === 'en' ? value : row.overrideEn,
                updatedAt: new Date().toISOString(),
              }
            : row,
        ),
      )
    } catch {
      setError('Error de red al guardar.')
    } finally {
      setBusyId(null)
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
    <div style={{ maxWidth: 1100 }}>
      {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '0 0 16px' }}>{error}</p>}

      {rows.length === 0 && (
        <p style={{ color: 'var(--fg-muted)', fontSize: 14, padding: '16px 0' }}>
          Ninguna clave coincide con estos filtros.
        </p>
      )}

      {[...grouped.entries()].map(([namespace, sections]) => {
        const total = [...sections.values()].reduce((n, arr) => n + arr.length, 0)
        return (
          <details key={namespace} open style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <summary style={{ fontWeight: 700, cursor: 'pointer', color: 'var(--fg)' }}>
              {namespace} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({total})</span>
            </summary>
            {[...sections.entries()].map(([section, items]) => {
              const route = routeForNamespaceSection(namespace, section)
              return (
              <details key={section} open style={{ marginLeft: 16, marginTop: 8 }}>
                <summary style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--fg)', fontSize: 14 }}>
                  {section} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({items.length})</span>
                  {' — '}
                  <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontFamily: 'var(--font-mono, monospace)' }}>
                    {route ? `${route.label} · ${route.path}` : NO_SINGLE_PAGE_LABEL}
                  </span>
                </summary>
                <div style={{ marginLeft: 16, marginTop: 4 }}>
                  {items.map((r) => {
                    const path = pathOf(r)
                    const hasOverrideEs = r.overrideEs !== null
                    const hasOverrideEn = r.overrideEn !== null
                    const busyEs = busyId === `${path}:es`
                    const busyEn = busyId === `${path}:en`
                    return (
                      <div key={path} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
                        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--fg-muted)' }}>
                          {r.key}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '2px 0 6px' }}>
                          Original: {r.defaultEs}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <textarea
                            rows={2}
                            value={draftValue(r, 'es')}
                            onChange={(e) => setDraft(r, 'es', e.target.value)}
                            style={inputStyle}
                          />
                          <button onClick={() => save(r, 'es')} disabled={busyEs} style={buttonStyle}>
                            {busyEs ? '…' : 'Guardar'}
                          </button>
                          {hasOverrideEs && (
                            <button onClick={() => restore(r, 'es')} disabled={busyEs} style={buttonStyle}>
                              Restaurar
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
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning, #b45309)' }}>
                                  ● Cambios sin guardar
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                  <div style={{ ...previewPaneStyle, background: 'var(--bg-subtle, rgba(128,128,128,0.08))' }}>
                                    <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Antes</div>
                                    <div style={{ color: 'var(--fg-muted)' }}>{before}</div>
                                  </div>
                                  <div style={{ ...previewPaneStyle, background: 'var(--bg-subtle, rgba(59,130,246,0.08))' }}>
                                    <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Después (borrador)</div>
                                    <div style={{ color: 'var(--fg)' }}>{after}</div>
                                  </div>
                                </div>
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
                              style={inputStyle}
                            />
                            <button onClick={() => save(r, 'en')} disabled={busyEn} style={buttonStyle}>
                              {busyEn ? '…' : 'Guardar'}
                            </button>
                            {hasOverrideEn && (
                              <button onClick={() => restore(r, 'en')} disabled={busyEn} style={buttonStyle}>
                                Restaurar
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
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning, #b45309)' }}>
                                  ● Cambios sin guardar (EN)
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                  <div style={{ ...previewPaneStyle, background: 'var(--bg-subtle, rgba(128,128,128,0.08))' }}>
                                    <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Antes</div>
                                    <div style={{ color: 'var(--fg-muted)' }}>{before}</div>
                                  </div>
                                  <div style={{ ...previewPaneStyle, background: 'var(--bg-subtle, rgba(59,130,246,0.08))' }}>
                                    <div style={{ color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 2 }}>Después (borrador)</div>
                                    <div style={{ color: 'var(--fg)' }}>{after}</div>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}
                      </div>
                    )
                  })}
                </div>
              </details>
              )
            })}
          </details>
        )
      })}

      {orphanRows.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>Overrides huérfanos</h2>
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
                <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, flex: 1 }}>
                  {o.namespace}.{o.key} ({o.locale}): {o.value}
                </span>
                <button onClick={() => deleteOrphan(o)} disabled={busyId === busyKey} style={buttonStyle}>
                  {busyId === busyKey ? '…' : 'Eliminar'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
