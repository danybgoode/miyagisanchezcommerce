'use client'

import { useEffect, useState, useCallback } from 'react'

interface BatchItem {
  id: string
  product_id: string
  title: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  valid: boolean
  error_message: string | null
  status: 'pending' | 'applying' | 'applied' | 'failed'
}

interface Batch {
  id: string
  status: string
  total_count: number
  valid_count: number
  applied_count: number
  failed_count: number
}

function formatValue(v: Record<string, unknown>): string {
  const entries = Object.entries(v)
  if (entries.length === 0) return '—'
  return entries.map(([, val]) => String(val)).join(', ')
}

/**
 * Staged-diff preview — catalog-management epic, Sprint 3 · Story 3.1.
 * Fetches the batch by id (driven by the parent's `?batch=` URL param, so a
 * page refresh mid-review re-fetches the SAME staged batch from Supabase —
 * the Shopify "lost work on refresh" failure mode this epic is designed
 * against). Old→new per row, validation errors inline, apply is idempotent
 * (a re-run reports "ya aplicado" for already-applied rows, never re-executes).
 */
export default function BulkDiffPreview({
  batchId,
  onClose,
  onApplied,
}: {
  batchId: string
  onClose: () => void
  onApplied: () => void
}) {
  const [batch, setBatch] = useState<Batch | null>(null)
  const [items, setItems] = useState<BatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ applied: number; failed: number; skipped: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sell/catalog/bulk/${batchId}`)
      const data = await res.json() as { batch?: Batch; items?: BatchItem[]; error?: string }
      if (!res.ok || !data.batch) {
        setError(data.error ?? 'Lote no encontrado.')
        return
      }
      setBatch(data.batch)
      setItems(data.items ?? [])
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [batchId])

  useEffect(() => { load() }, [load])

  async function handleApply() {
    setApplying(true)
    setError(null)
    try {
      const res = await fetch(`/api/sell/catalog/bulk/${batchId}/apply`, { method: 'POST' })
      const data = await res.json() as { applied?: number; failed?: number; skipped?: number; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Error al aplicar el lote.')
        return
      }
      setResult({ applied: data.applied ?? 0, failed: data.failed ?? 0, skipped: data.skipped ?? 0 })
      await load()
      onApplied()
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setApplying(false)
    }
  }

  const validCount = items.filter((i) => i.valid).length
  const invalidCount = items.length - validCount
  const alreadyApplied = items.every((i) => i.status !== 'pending') && items.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-full overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">Previsualizar cambios en bloque</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]" aria-label="Cerrar">×</button>
        </div>

        {loading && <p className="text-sm text-[var(--color-muted)]">Cargando…</p>}
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {!loading && batch && (
          <>
            <p className="text-sm text-[var(--color-muted)] mb-4">
              {validCount} válido{validCount === 1 ? '' : 's'}
              {invalidCount > 0 && <span className="text-red-600"> · {invalidCount} con error</span>}
            </p>

            {result && (
              <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm">
                <strong>{result.applied}</strong> aplicado{result.applied === 1 ? '' : 's'}
                {result.failed > 0 && <span className="text-red-600"> · {result.failed} falló/fallaron</span>}
                {result.skipped > 0 && <span> · {result.skipped} ya aplicado(s)</span>}
              </div>
            )}

            <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    <th className="p-2 font-medium">Producto</th>
                    <th className="p-2 font-medium">Antes</th>
                    <th className="p-2 font-medium">Después</th>
                    <th className="p-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={`border-b border-[var(--color-border)] last:border-0 ${!item.valid ? 'bg-red-50' : ''}`}>
                      <td className="p-2 truncate max-w-[200px]">{item.title}</td>
                      <td className="p-2 text-[var(--color-muted)]">{formatValue(item.before)}</td>
                      <td className="p-2 font-medium">{item.valid ? formatValue(item.after) : '—'}</td>
                      <td className="p-2">
                        {item.status === 'applying' && <span className="inline-block rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-semibold">Aplicando…</span>}
                        {item.status === 'applied' && <span className="inline-block rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">Aplicado</span>}
                        {item.status === 'failed' && <span className="inline-block rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold" title={item.error_message ?? undefined}>Falló</span>}
                        {item.status === 'pending' && item.valid && <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-semibold">Pendiente</span>}
                        {item.status === 'pending' && !item.valid && <span className="inline-block rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold" title={item.error_message ?? undefined}>Corregir</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded border border-[var(--color-border)] text-sm hover:bg-gray-50">
                Cerrar
              </button>
              <button
                onClick={handleApply}
                disabled={applying || validCount === 0}
                className="btn btn-primary disabled:opacity-50"
              >
                {applying ? 'Aplicando…' : alreadyApplied ? 'Ya aplicado — reintentar' : `Aplicar (${validCount})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
