'use client'

import { useEffect, useMemo, useState } from 'react'

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
 * admin-content-and-announcements, Sprint 1). **Clerk-gated** — the same-origin
 * fetch carries the session cookie. Every key from the compile-time dictionary is
 * listed with its default value always visible; editing + saving upserts a
 * `platform_copy_overrides` row (live within ≤1 min via cache TTL, or instantly
 * via on-demand revalidation); «restaurar» deletes the row, reverting to the
 * compile-time default. `en` inputs render ONLY for a bilingual-allow-listed
 * namespace (AGENTS rule #5).
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
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<Locale, string>>>>({})

  // Re-sync from fresh server props after a `router.refresh()` — e.g. the bulk
  // import/export panel triggers one after applying a batch, so the per-key list
  // below doesn't keep showing pre-apply values until a manual reload.
  useEffect(() => setRows(keys), [keys])
  useEffect(() => setOrphanRows(orphans), [orphans])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => pathOf(r).toLowerCase().includes(q) || r.defaultEs.toLowerCase().includes(q),
    )
  }, [rows, filter])

  const grouped = useMemo(() => {
    const byNamespace = new Map<string, Map<string, OverrideKeyView[]>>()
    for (const r of filtered) {
      const section = r.key.split('.')[0] ?? r.key
      if (!byNamespace.has(r.namespace)) byNamespace.set(r.namespace, new Map())
      const bySection = byNamespace.get(r.namespace)!
      if (!bySection.has(section)) bySection.set(section, [])
      bySection.get(section)!.push(r)
    }
    return byNamespace
  }, [filtered])

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
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: 'var(--fg)' }}>Contenido</h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: 14, margin: '0 0 8px' }}>
        Edita el copy de marketing ya publicado, sin deploy. Se ve en vivo en ≤1 min (o al instante, tras guardar).
      </p>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Solo se pueden editar claves que ya existen en el diccionario — «Original» siempre muestra el
        valor de fábrica. «Restaurar» borra el override y vuelve al valor de fábrica.
      </p>

      {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '0 0 16px' }}>{error}</p>}

      <input
        type="text"
        placeholder="Buscar por página, sección o texto…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ ...inputStyle, marginBottom: 16, width: '100%', maxWidth: 400 }}
      />

      {[...grouped.entries()].map(([namespace, sections]) => {
        const total = [...sections.values()].reduce((n, arr) => n + arr.length, 0)
        return (
          <details key={namespace} open={filter.length > 0} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <summary style={{ fontWeight: 700, cursor: 'pointer', color: 'var(--fg)' }}>
              {namespace} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({total})</span>
            </summary>
            {[...sections.entries()].map(([section, items]) => (
              <details key={section} open={filter.length > 0} style={{ marginLeft: 16, marginTop: 8 }}>
                <summary style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--fg)', fontSize: 14 }}>
                  {section} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({items.length})</span>
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
                      </div>
                    )
                  })}
                </div>
              </details>
            ))}
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
