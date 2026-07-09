'use client'

import { useState } from 'react'

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

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  background: 'var(--bg)',
  color: 'var(--fg)',
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
 * admin-content-and-announcements, Sprint 1). Export is a plain same-origin
 * download link (the Clerk session cookie rides along); import is a two-step
 * handshake — `POST .../import` parses + diffs WITHOUT writing, then the admin
 * reviews the diff and `POST .../import/apply` writes only the checked rows.
 * `unchanged` rows are never shown (they'd just be noise); `skippedUnknown` rows
 * are shown but can't be selected — the dictionary defines the universe.
 */
export default function ContenidoImportExportPanel() {
  const [scopeNamespace, setScopeNamespace] = useState('')
  const [scopeSection, setScopeSection] = useState('')
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
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--fg)' }}>Exportar / importar en bloque</h2>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13, margin: '0 0 12px' }}>
        Exporta el copy (todo, o filtrado por página/sección), edítalo en una hoja de cálculo, y vuelve a
        importarlo. Solo se aplican las filas que revises y confirmes abajo — nunca se escribe nada al leer
        el archivo.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Página (namespace) — opcional, ej. sellerAcquisition"
          value={scopeNamespace}
          onChange={(e) => setScopeNamespace(e.target.value)}
          style={{ ...inputStyle, flex: 'none', width: 260 }}
        />
        <input
          type="text"
          placeholder="Sección — opcional, ej. anchor"
          value={scopeSection}
          onChange={(e) => setScopeSection(e.target.value)}
          style={{ ...inputStyle, flex: 'none', width: 180 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {(['csv', 'xlsx', 'json'] as const).map((format) => {
          const params = new URLSearchParams({ format })
          if (scopeNamespace) params.set('namespace', scopeNamespace)
          if (scopeSection) params.set('section', scopeSection)
          return (
            <a key={format} href={`/api/admin/content-overrides/export?${params.toString()}`} style={buttonStyle}>
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
                  <th style={{ padding: '6px 8px' }}>Locale</th>
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
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono, monospace)' }}>
                        {r.namespace}.{r.key}
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
            style={{ ...buttonStyle, marginTop: 12, opacity: selectedCount === 0 ? 0.5 : 1 }}
          >
            {busy ? '…' : `Confirmar e importar (${selectedCount})`}
          </button>
        </div>
      )}
    </div>
  )
}
