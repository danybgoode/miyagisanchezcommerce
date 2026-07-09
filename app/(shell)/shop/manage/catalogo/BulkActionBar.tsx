'use client'

import { useState, useEffect } from 'react'
import type { CatalogSearchParams } from '@/lib/catalog-query'
import { CATEGORIES } from '@/lib/types'

export type BulkActionType =
  | 'price_set' | 'price_pct' | 'pause_activate' | 'publish_channel'
  | 'category' | 'collection_assign' | 'inventory_mode' | 'delete'

interface BulkActionBarProps {
  selectedCount: number
  totalFiltered: number
  allVisibleSelected: boolean
  filterParams: CatalogSearchParams
  selectedIds: string[]
  onStaged: (batchId: string) => void
  onClearSelection: () => void
}

interface SellerCollection { id: string; handle: string; name: string }

const DISPATCH_ESTIMATES = [
  { value: '1-3d', label: '1–3 días hábiles' },
  { value: '3-5d', label: '3–5 días hábiles' },
  { value: '1-2w', label: '1–2 semanas' },
]

/**
 * Bulk action builder — catalog-management epic, Sprint 3 · Stories 3.1
 * (price/pause_activate) + 3.2 (full action set). Shown when at least one
 * row is selected. Offers "seleccionar todos (N)" across the active filter
 * (not just the visible page — the Shopify 50-row-session failure mode this
 * epic is designed against), then stages the chosen action for a diff
 * preview (nothing is written here).
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
  const [channel, setChannel] = useState<'miyagi' | 'ml'>('miyagi')
  const [channelEnabled, setChannelEnabled] = useState(true)
  const [categoryKey, setCategoryKey] = useState<string>(CATEGORIES[0]?.key ?? '')
  const [collections, setCollections] = useState<SellerCollection[]>([])
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set())
  const [inventoryMode, setInventoryMode] = useState<'tracked' | 'unlimited' | 'backorder'>('tracked')
  const [dispatchEstimate, setDispatchEstimate] = useState(DISPATCH_ESTIMATES[0].value)
  const [staging, setStaging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (actionType !== 'collection_assign' || collections.length > 0) return
    fetch('/api/sell/collections')
      .then((r) => r.json())
      .then((data: { collections?: SellerCollection[] }) => setCollections(data.collections ?? []))
      .catch(() => {})
  }, [actionType, collections.length])

  const effectiveCount = acrossFilter ? totalFiltered : selectedCount

  function toggleCollection(id: string) {
    setSelectedCollectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
    } else if (actionType === 'pause_activate') {
      action = { type: 'pause_activate', status: pauseTarget }
    } else if (actionType === 'publish_channel') {
      action = { type: 'publish_channel', channel, enabled: channelEnabled }
    } else if (actionType === 'category') {
      const cat = CATEGORIES.find((c) => c.key === categoryKey)
      if (!cat) {
        setError('Elige una categoría válida.')
        return
      }
      action = { type: 'category', category_handle: cat.key, category_label: cat.label }
    } else if (actionType === 'collection_assign') {
      const ids = [...selectedCollectionIds]
      const labels = collections.filter((c) => selectedCollectionIds.has(c.id)).map((c) => c.name)
      action = { type: 'collection_assign', collection_ids: ids, collection_labels: labels }
    } else if (actionType === 'inventory_mode') {
      action = {
        type: 'inventory_mode',
        mode: inventoryMode,
        ...(inventoryMode === 'backorder' && { dispatch_estimate: dispatchEstimate }),
      }
    } else {
      action = { type: 'delete' }
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
            <option value="publish_channel">Publicar / ocultar por canal</option>
            <option value="category">Cambiar categoría</option>
            <option value="collection_assign">Asignar colecciones</option>
            <option value="inventory_mode">Modo de inventario</option>
            <option value="delete">Eliminar</option>
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

        {actionType === 'publish_channel' && (
          <>
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Canal</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'miyagi' | 'ml')}
                className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
              >
                <option value="miyagi">Miyagi (marketplace)</option>
                <option value="ml">Mercado Libre</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Acción</label>
              <select
                value={channelEnabled ? 'on' : 'off'}
                onChange={(e) => setChannelEnabled(e.target.value === 'on')}
                className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
              >
                <option value="on">Publicar</option>
                <option value="off">Ocultar</option>
              </select>
            </div>
          </>
        )}

        {actionType === 'category' && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Nueva categoría</label>
            <select
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
            >
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        )}

        {actionType === 'collection_assign' && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Colecciones (reemplaza las actuales)</label>
            {collections.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)]">No tienes colecciones — créalas en Catálogo → Colecciones.</p>
            ) : (
              <div className="flex gap-2 flex-wrap max-w-md">
                {collections.map((c) => (
                  <label key={c.id} className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 cursor-pointer">
                    <input type="checkbox" checked={selectedCollectionIds.has(c.id)} onChange={() => toggleCollection(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {actionType === 'inventory_mode' && (
          <>
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Modo</label>
              <select
                value={inventoryMode}
                onChange={(e) => setInventoryMode(e.target.value as 'tracked' | 'unlimited' | 'backorder')}
                className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
              >
                <option value="tracked">Rastreado</option>
                <option value="unlimited">Sin límite</option>
                <option value="backorder">Sobre pedido</option>
              </select>
            </div>
            {inventoryMode === 'backorder' && (
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Envío estimado</label>
                <select
                  value={dispatchEstimate}
                  onChange={(e) => setDispatchEstimate(e.target.value)}
                  className="border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
                >
                  {DISPATCH_ESTIMATES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {actionType === 'delete' && (
          <p className="text-xs text-[var(--color-muted)] max-w-xs">
            Previsualiza antes de aplicar — esta acción no se puede deshacer.
          </p>
        )}

        <button
          type="button"
          onClick={handleStage}
          disabled={staging || (actionType === 'collection_assign' && collections.length === 0)}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {staging ? 'Preparando…' : 'Previsualizar'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}
