'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  countForScope,
  describeExportScope,
  namespacesInIndex,
  sectionsForNamespace,
  type KeyIndexEntry,
} from '@/lib/copy-overrides-export-scope'
import { namespaceLabel, routeForNamespaceSection } from '@/lib/copy-overrides-routes'

export type { KeyIndexEntry }

type ImportDiffAction = 'added' | 'changed' | 'unchanged' | 'skippedUnknown'

type ImportDiffRow = {
  namespace: string
  key: string
  locale: string
  action: ImportDiffAction
  previousValue: string | null
  newValue: string
}

type ApplyResult = {
  applied: number
  rejected: Array<{ namespace?: unknown; key?: unknown; error: string }>
}

function rowKey(r: { namespace: string; key: string; locale: string }): string {
  return `${r.namespace}.${r.key}.${r.locale}`
}

/** Read a File as base64 (no `data:` prefix) — used for the XLSX upload. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatForFile(file: File): 'csv' | 'xlsx' | 'json' | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.xlsx')) return 'xlsx'
  if (name.endsWith('.json')) return 'json'
  return null
}

/**
 * Bulk export/import for the runtime copy-override layer (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.2 — scope inputs became
 * predefined dropdowns with a default + a live plain-language summary,
 * replacing the original free-text namespace/section fields). Export is a
 * plain same-origin download link (the Clerk session cookie rides along);
 * import is a two-step handshake — `POST .../import` parses + diffs WITHOUT
 * writing, then the admin reviews the diff and `POST .../import/apply` writes
 * only the checked rows. `unchanged` rows are never shown (they'd just be
 * noise); `skippedUnknown` rows are shown but can't be selected — the
 * dictionary defines the universe.
 */
export default function ContenidoImportExportPanel({ keyIndex }: { keyIndex: KeyIndexEntry[] }) {
  const router = useRouter()
  const [scopeNamespace, setScopeNamespace] = useState('')
  const [scopeSection, setScopeSection] = useState('')
  const namespaces = useMemo(() => namespacesInIndex(keyIndex), [keyIndex])
  const sections = useMemo(() => sectionsForNamespace(keyIndex, scopeNamespace), [keyIndex, scopeNamespace])
  const scopeCount = useMemo(
    () => countForScope(keyIndex, scopeNamespace, scopeSection),
    [keyIndex, scopeNamespace, scopeSection],
  )
  const scopeSummary = useMemo(
    () => describeExportScope(scopeNamespace, scopeSection, scopeCount),
    [scopeNamespace, scopeSection, scopeCount],
  )
  const [diff, setDiff] = useState<ImportDiffRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  async function handleFile(file: File) {
    const format = formatForFile(file)
    if (!format) {
      setError('Formato no reconocido — usa .csv, .xlsx o .json.')
      return
    }
    setBusy(true)
    setError(null)
    setApplyResult(null)
    setDiff(null)
    try {
      const content = format === 'xlsx' ? await readFileAsBase64(file) : await file.text()
      const res = await fetch('/api/admin/content-overrides/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, content }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo leer el archivo.')
        return
      }
      const rows: ImportDiffRow[] = (data.diff ?? []).filter((r: ImportDiffRow) => r.action !== 'unchanged')
      setDiff(rows)
      setSelected(new Set(rows.filter((r) => r.action === 'added' || r.action === 'changed').map(rowKey)))
    } catch {
      setError('Error de red al leer el archivo.')
    } finally {
      setBusy(false)
      setFileInputKey((k) => k + 1) // reset the <input type=file> so re-selecting the same file re-fires onChange
    }
  }

  function toggle(row: ImportDiffRow) {
    if (row.action === 'skippedUnknown') return
    const key = rowKey(row)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function applySelected() {
    if (!diff) return
    const rows = diff
      .filter((r) => selected.has(rowKey(r)))
      .map((r) => ({ namespace: r.namespace, key: r.key, locale: r.locale, value: r.newValue }))
    if (rows.length === 0) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/content-overrides/import/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo aplicar el import.')
        return
      }
      setApplyResult({ applied: data.applied ?? 0, rejected: data.rejected ?? [] })
      setDiff(null)
      setSelected(new Set())
      // Re-fetch the server-rendered page data so the per-key editor below reflects
      // this batch immediately, instead of showing pre-apply values until reload.
      router.refresh()
    } catch {
      setError('Error de red al aplicar el import.')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = selected.size
  const actionLabel: Record<ImportDiffAction, string> = {
    added: 'nuevo',
    changed: 'cambiado',
    unchanged: 'sin cambio',
    skippedUnknown: 'clave desconocida — se omite',
  }

  return (
    <div className="card-panel" style={{ padding: 16, marginBottom: 24 }}>
      <h2 className="t-h4" style={{ margin: '0 0 4px', color: 'var(--fg)' }}>Exportar / importar en bloque</h2>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13, margin: '0 0 12px' }}>
        Exporta el copy (todo, o filtrado por página/sección), edítalo en una hoja de cálculo, y vuelve a
        importarlo. Solo se aplican las filas que revises y confirmes abajo — nunca se escribe nada al leer
        el archivo.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select
          value={scopeNamespace}
          onChange={(e) => {
            setScopeNamespace(e.target.value)
            setScopeSection('') // cascading — a section from the PREVIOUS namespace can't carry over
          }}
          className="input"
          style={{ flex: 'none', width: 260 }}
        >
          <option value="">Todas las páginas</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {namespaceLabel(ns)}
            </option>
          ))}
        </select>
        <select
          value={scopeSection}
          onChange={(e) => setScopeSection(e.target.value)}
          disabled={!scopeNamespace}
          className="input"
          style={{ flex: 'none', width: 220, opacity: scopeNamespace ? 1 : 0.5 }}
        >
          <option value="">Todas las secciones</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {routeForNamespaceSection(scopeNamespace, s)?.label ?? s}
            </option>
          ))}
        </select>
      </div>

      <p style={{ color: 'var(--fg)', fontSize: 13, margin: '0 0 12px', fontWeight: 600 }}>{scopeSummary}</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {(['csv', 'xlsx', 'json'] as const).map((format) => {
          const params = new URLSearchParams({ format })
          if (scopeNamespace) params.set('namespace', scopeNamespace)
          if (scopeSection) params.set('section', scopeSection)
          return (
            <a
              key={format}
              href={`/api/admin/content-overrides/export?${params.toString()}`}
              className="btn btn-secondary btn-sm no-underline"
            >
              Exportar {format.toUpperCase()}
            </a>
          )
        })}
      </div>

      <input
        key={fileInputKey}
        type="file"
        accept=".csv,.xlsx,.json"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}

      {applyResult && (
        <p style={{ fontSize: 13, margin: '12px 0 0', color: 'var(--fg)' }}>
          Se aplicaron {applyResult.applied} cambios.
          {applyResult.rejected.length > 0 && ` ${applyResult.rejected.length} filas se rechazaron (revisa las claves).`}
        </p>
      )}

      {diff && diff.length === 0 && (
        <p style={{ fontSize: 13, margin: '12px 0 0', color: 'var(--fg-muted)' }}>
          Sin cambios — el archivo coincide con lo que ya está publicado.
        </p>
      )}

      {diff && diff.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '6px 8px' }} />
                  <th style={{ padding: '6px 8px' }}>Clave</th>
                  <th style={{ padding: '6px 8px' }}>Idioma</th>
                  <th style={{ padding: '6px 8px' }}>Acción</th>
                  <th style={{ padding: '6px 8px' }}>Antes</th>
                  <th style={{ padding: '6px 8px' }}>Después</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((r) => {
                  const key = rowKey(r)
                  const disabled = r.action === 'skippedUnknown'
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border)', opacity: disabled ? 0.5 : 1 }}>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          disabled={disabled}
                          onChange={() => toggle(r)}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <span className="badge-mono">{r.namespace}.{r.key}</span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>{r.locale}</td>
                      <td style={{ padding: '6px 8px' }}>{actionLabel[r.action]}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 240 }}>{r.previousValue ?? '—'}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 240 }}>{r.newValue}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button
            onClick={applySelected}
            disabled={busy || selectedCount === 0}
            className="btn btn-primary btn-sm"
            style={{ marginTop: 12, opacity: selectedCount === 0 ? 0.5 : 1 }}
          >
            {busy ? '…' : `Confirmar e importar (${selectedCount})`}
          </button>
        </div>
      )}
    </div>
  )
}
