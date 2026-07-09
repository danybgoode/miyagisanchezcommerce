'use client'

import { useState } from 'react'
import type { CatalogSearchParams } from '@/lib/catalog-query'

export type BulkActionType = 'price_set' | 'price_pct' | 'pause_activate'

interface BulkActionBarProps {
  selectedCount: number
  totalFiltered: number
  allVisibleSelected: boolean
  filterParams: CatalogSearchParams
  selectedIds: string[]
  onStaged: (batchId: string) => void
  onClearSelection: () => void
}

/**
 * Bulk action builder — catalog-management epic, Sprint 3 · Story 3.1. Shown
 * when at least one row is selected. Offers "seleccionar todos (N)" across
 * the active filter (not just the visible page — the Shopify 50-row-session
 * failure mode this epic is designed against), then stages the chosen action
 * for a diff preview (nothing is written here).
 */
export default function BulkActionBar({
  selectedCount,
  totalFiltered,
  allVisibleSelected,
  filterParams,
  selectedIds,
  onStaged,
  onClearSelection,
}: BulkActionBarProps) {
  const [acrossFilter, setAcrossFilter] = useState(false)
  const [actionType, setActionType] = useState<BulkActionType>('price_pct')
  const [priceCents, setPriceCents] = useState('')
  const [percent, setPercent] = useState('')
  const [pauseTarget, setPauseTarget] = useState<'active' | 'paused'>('paused')
  const [staging, setStaging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveCount = acrossFilter ? totalFiltered : selectedCount

  async function handleStage() {
    setError(null)

    let action: Record<string, unknown>
    if (actionType === 'price_set') {
      const cents = Math.round(parseFloat(priceCents) * 100)
      if (!Number.isFinite(cents) || cents <= 0) {
        setError('Indica un precio válido mayor a $0.')
        return
      }
      action = { type: 'price_set', price_cents: cents }
    } else if (actionType === 'price_pct') {
      const pct = parseFloat(percent)
      if (!Number.isFinite(pct) || pct === 0) {
        setError('Indica un porcentaje distinto de 0 (ej. 10 o -10).')
        return
      }
      action = { type: 'price_pct', percent: pct }
    } else {
      action = { type: 'pause_activate', status: pauseTarget }
    }

    setStaging(true)
    try {
      const res = await fetch('/api/sell/catalog/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          acrossFilter
            ? { filter: filterParams, action }
            : { ids: selectedIds, action },
        ),
      })
      const data = await res.json() as { batch_id?: string; error?: string }
      if (!res.ok || !data.batch_id) {
        setError(data.error ?? 'Error al preparar el lote.')
        return
      }
      onStaged(data.batch_id)
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setStaging(false)
    }
  }

  return (
    <div className="sticky top-0 z-10 mb-3 rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="text-sm">
          <strong>{effectiveCount}</strong> anuncio{effectiveCount === 1 ? '' : 's'} seleccionado{effectiveCount === 1 ? '' : 's'}
          {allVisibleSelected && totalFiltered > selectedCount && !acrossFilter && (
            <>
              {' — '}
              <button type="button" onClick={() => setAcrossFilter(true)} className="text-[var(--color-accent)] hover:underline font-medium">
                Seleccionar todos ({totalFiltered}) que coinciden con el filtro
              </button>
            </>
          )}
          {acrossFilter && (
            <>
              {' — '}
              <button type="button" onClick={() => setAcrossFilter(false)} className="text-[var(--color-muted)] hover:underline">
                Solo esta página
              </button>
            </>
          )}
        </div>
        <button type="button" onClick={onClearSelection} className="text-sm text-[var(--color-muted)] hover:underline">
          Cancelar selección
        </button>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Acción</label>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as BulkActionType)}
            className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
          >
            <option value="price_pct">Cambiar precio (%)</option>
            <option value="price_set">Fijar precio</option>
            <option value="pause_activate">Pausar / activar</option>
          </select>
        </div>

        {actionType === 'price_pct' && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Porcentaje (ej. 10 o -10)</label>
            <input
              type="number"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="10"
              className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm w-28"
            />
          </div>
        )}

        {actionType === 'price_set' && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Nuevo precio</label>
            <input
              type="number"
              value={priceCents}
              onChange={(e) => setPriceCents(e.target.value)}
              placeholder="199.00"
              className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm w-28"
            />
          </div>
        )}

        {actionType === 'pause_activate' && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Estado</label>
            <select
              value={pauseTarget}
              onChange={(e) => setPauseTarget(e.target.value as 'active' | 'paused')}
              className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
            >
              <option value="paused">Pausar</option>
              <option value="active">Activar</option>
            </select>
          </div>
        )}

        <button type="button" onClick={handleStage} disabled={staging} className="btn btn-primary btn-sm disabled:opacity-50">
          {staging ? 'Preparando…' : 'Previsualizar'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}
