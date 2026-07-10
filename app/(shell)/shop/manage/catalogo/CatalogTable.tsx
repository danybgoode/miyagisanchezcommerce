'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { deriveCatalogStatus } from '@/lib/catalog-status'
import { deriveChannelBadges } from '@/lib/catalog-channels'
import { PROCESSING_LABELS } from '@/lib/trust-inputs'
import type { CatalogSearchParams } from '@/lib/catalog-query'
import { deriveProductMargin, type MarginCell } from '@/lib/catalog-margin'
import { formatCents, formatPct, type SkuMarginRow } from '@/lib/profit'
import BulkActionBar from './BulkActionBar'
import BulkDiffPreview from './BulkDiffPreview'

export interface CatalogListing {
  id: string
  title: string
  sku: string | null
  price_cents: number | null
  currency: string
  category: string | null
  status: string
  manage_inventory: boolean
  available_quantity: number | null
  /** Reserved units (in-flight orders); null = unlimited (catalog-management S2 · 2.1). */
  reserved_quantity?: number | null
  in_stock: boolean
  /** Native Medusa "sobre pedido" flag (catalog-management S2 · 2.1). */
  allow_backorder?: boolean
  /** Seller's estimated dispatch note for a backorder listing (catalog-management S2 · 2.1). */
  dispatch_estimate?: string | null
  /** Marketplace-browse visibility toggle (catalog-management S2 · 2.2) — absent = true. */
  miyagi_visible?: boolean
  /** Optional Mercado Libre-specific price override, in centavos (catalog-management S2 · 2.3). */
  ml_price_cents?: number | null
  channels: string[]
  images: Array<{ url: string; alt?: string | null }>
  created_at: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  activo: { label: 'Activo', color: 'bg-green-100 text-green-700' },
  pausado: { label: 'Pausado', color: 'bg-amber-100 text-amber-700' },
  borrador: { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  agotado: { label: 'Agotado', color: 'bg-red-100 text-red-600' },
  sobre_pedido: { label: 'Sobre pedido', color: 'bg-blue-100 text-blue-700' },
}

function formatPrice(cents: number | null, currency: string) {
  if (cents === null) return 'Precio a convenir'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function stockLabel(listing: CatalogListing) {
  if (listing.manage_inventory && listing.allow_backorder) {
    if (!listing.dispatch_estimate) return 'Sobre pedido'
    const label = PROCESSING_LABELS[listing.dispatch_estimate] ?? listing.dispatch_estimate
    return `Sobre pedido — ${label}`
  }
  if (!listing.manage_inventory) return 'Sin límite'
  if (!listing.in_stock) return 'Agotado'
  const reserved = listing.reserved_quantity ?? 0
  return reserved > 0
    ? `${listing.available_quantity ?? 0} disponibles (${reserved} reservados)`
    : `${listing.available_quantity ?? 0} disponibles`
}

// Margin column (catalog-management S4 · Story 4.1) — one honest cell per
// channel, never a fake number. `formatCents`/`formatPct` are the SAME
// formatters the profit dashboard uses (no forked display logic either).
function MarginCellDisplay({ label, cell }: { label: string; cell: MarginCell }) {
  if (cell.state === 'no_sales') {
    return <span className="text-[10px] text-[var(--color-muted)]">{label}: sin ventas</span>
  }
  if (cell.state === 'no_cogs') {
    return (
      <span className="text-[10px] text-amber-700">
        {label}: sin COGS ·{' '}
        <Link href="/shop/manage/profit" className="underline">registrar costo</Link>
      </span>
    )
  }
  return (
    <span className={`text-[10px] ${cell.isKiller ? 'text-red-600 font-semibold' : 'text-[var(--color-muted)]'}`}>
      {label}: {formatCents(cell.marginCents ?? 0)} · {formatPct(cell.marginPct ?? null)}
      {cell.isKiller && ' ⚠'}
    </span>
  )
}

interface ToastState { message: string; type: 'success' | 'error' }

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100" aria-label="Cerrar">×</button>
    </div>
  )
}

function DeleteDialog({
  listing,
  onConfirm,
  onCancel,
  pending,
}: {
  listing: CatalogListing
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="font-bold text-base mb-2">¿Eliminar anuncio?</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Se eliminará <strong className="text-[var(--color-foreground)]">{listing.title}</strong>. Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} disabled={pending} className="px-4 py-2 rounded border border-[var(--color-border)] text-sm hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={pending} className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {pending ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

type MarginSort = 'none' | 'asc' | 'desc'

export default function CatalogTable({
  listings: initialListings,
  channelsFlagEnabled = false,
  mlEntitled = false,
  bulkFlagEnabled = false,
  totalFiltered = 0,
  filterParams = {},
  profitFlagEnabled = false,
  marginRowsByChannel = [],
}: {
  listings: CatalogListing[]
  /** catalog.inventory_channels_enabled (catalog-management S2 · 2.2) — fail-safe OFF: no toggle UI renders while OFF. */
  channelsFlagEnabled?: boolean
  /** `ml_sync` entitlement — disables (not hides) the ML toggle with an upsell hint when false. */
  mlEntitled?: boolean
  /** catalog.bulk_enabled (catalog-management S3) — fail-safe OFF: no selection/bulk UI renders while OFF. */
  bulkFlagEnabled?: boolean
  /** Total count matching the active filter (server-reported, not just this page) — powers "seleccionar todos (N)". */
  totalFiltered?: number
  /** The active table filter (q/status/category/channel/stock/sort) — passed through to a "select all across filter" bulk stage. */
  filterParams?: CatalogSearchParams
  /** ops.profit_enabled (catalog-management S4 · Story 4.1) — fail-safe OFF: no Margen column/sort toggle render while OFF. */
  profitFlagEnabled?: boolean
  /** Per-channel ledger rows (lib/profit.ts's computeSkuMarginsByChannel), already fetched server-side. */
  marginRowsByChannel?: SkuMarginRow[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [listings, setListings] = useState(initialListings)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CatalogListing | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [marginSort, setMarginSort] = useState<MarginSort>('none')

  // Margin cells, keyed by product id — derived once per render from the
  // server-fetched ledger rows (lib/catalog-margin.ts, pure, no formula fork).
  const marginByProduct = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveProductMargin>>()
    if (!profitFlagEnabled) return map
    for (const listing of listings) {
      map.set(listing.id, deriveProductMargin(listing.id, marginRowsByChannel))
    }
    return map
  }, [profitFlagEnabled, listings, marginRowsByChannel])

  // Client-only sort, THIS PAGE ONLY (24 rows) — margin is a bounded ledger
  // aggregate, not a persisted/indexed product field, so this deliberately
  // does not touch the URL-driven server sort (lib/catalog-query.ts). Rows
  // with no computed Miyagi margin (no_sales/no_cogs) always sort last,
  // regardless of direction — they can't be meaningfully ranked.
  const displayedListings = useMemo(() => {
    if (marginSort === 'none' || !profitFlagEnabled) return listings
    const withValue: Array<{ listing: CatalogListing; value: number }> = []
    const withoutValue: CatalogListing[] = []
    for (const listing of listings) {
      const cell = marginByProduct.get(listing.id)?.miyagi
      if (cell?.state === 'computed' && cell.marginCents != null) withValue.push({ listing, value: cell.marginCents })
      else withoutValue.push(listing)
    }
    withValue.sort((a, b) => (marginSort === 'asc' ? a.value - b.value : b.value - a.value))
    return [...withValue.map((v) => v.listing), ...withoutValue]
  }, [listings, marginSort, marginByProduct, profitFlagEnabled])

  const activeBatchId = searchParams.get('batch')

  function setBatchInUrl(batchId: string | null) {
    const sp = new URLSearchParams(searchParams.toString())
    if (batchId) sp.set('batch', batchId)
    else sp.delete('batch')
    router.push(sp.toString() ? `${pathname}?${sp.toString()}` : pathname)
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) =>
      prev.size === listings.length ? new Set() : new Set(listings.map((l) => l.id)),
    )
  }

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const markPending = (id: string, on: boolean) =>
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  async function handleToggle(listing: CatalogListing, next: 'active' | 'paused') {
    const id = listing.id
    const prevStatus = deriveCatalogStatus(listing)
    markPending(id, true)
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, status: next === 'active' ? 'active' : 'paused' } : l)))

    try {
      const res = await fetch(`/api/sell/listing/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setListings((prev) => prev.map((l) => (l.id === id ? { ...l, status: prevStatus === 'pausado' ? 'paused' : 'active' } : l)))
        showToast(data.error ?? 'Error al cambiar el estado.', 'error')
      } else {
        showToast(next === 'active' ? 'Anuncio activado.' : 'Anuncio pausado.', 'success')
      }
    } catch {
      setListings((prev) => prev.map((l) => (l.id === id ? { ...l, status: prevStatus === 'pausado' ? 'paused' : 'active' } : l)))
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      markPending(id, false)
    }
  }

  // Miyagi marketplace-browse visibility toggle (catalog-management S2 · 2.2)
  // — independent of pause/activate: only affects `/l` browse, never this
  // seller's own storefront. Same optimistic/rollback/toast pattern as
  // handleToggle above.
  async function handleMiyagiToggle(listing: CatalogListing) {
    const id = listing.id
    const prevVisible = listing.miyagi_visible !== false
    const next = !prevVisible
    markPending(id, true)
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, miyagi_visible: next } : l)))

    try {
      const res = await fetch(`/api/sell/listing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ miyagi_visible: next }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setListings((prev) => prev.map((l) => (l.id === id ? { ...l, miyagi_visible: prevVisible } : l)))
        showToast(data.error ?? 'Error al cambiar la visibilidad.', 'error')
      } else {
        showToast(next ? 'Visible en el marketplace Miyagi.' : 'Oculto del marketplace Miyagi (sigue en tu tienda).', 'success')
      }
    } catch {
      setListings((prev) => prev.map((l) => (l.id === id ? { ...l, miyagi_visible: prevVisible } : l)))
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      markPending(id, false)
    }
  }

  // Mercado Libre publish toggle (catalog-management S2 · 2.2). Always
  // attempts the toggle write in place (works whether the product was
  // previously linked+closed or genuinely never linked) — the backend tells
  // us via `needs_category` when turning ON hit a never-linked product with
  // no ML category yet, in which case we deep-link to the edit page's
  // existing predict→confirm flow instead of building a second one here.
  async function handleMlToggle(listing: CatalogListing) {
    const id = listing.id
    const wasOn = (listing.channels ?? []).includes('ml')
    const next = !wasOn
    const rollbackChannels = listing.channels ?? ['miyagi']
    markPending(id, true)
    setListings((prev) => prev.map((l) => (l.id === id
      ? { ...l, channels: next ? [...(l.channels ?? ['miyagi']), 'ml'] : (l.channels ?? []).filter((c) => c !== 'ml') }
      : l)))

    try {
      const res = await fetch(`/api/sell/listing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ml_enabled: next }),
      })
      const data = await res.json() as { error?: string; needs_category?: boolean }
      if (!res.ok) {
        setListings((prev) => prev.map((l) => (l.id === id ? { ...l, channels: rollbackChannels } : l)))
        showToast(data.error ?? 'Error al cambiar Mercado Libre.', 'error')
      } else if (next && data.needs_category) {
        showToast('Elige una categoría de Mercado Libre para terminar de publicar…', 'success')
        router.push(`/sell/edit/${id}`)
      } else {
        showToast(next ? 'Publicado en Mercado Libre.' : 'Desactivado en Mercado Libre.', 'success')
      }
    } catch {
      setListings((prev) => prev.map((l) => (l.id === id ? { ...l, channels: rollbackChannels } : l)))
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      markPending(id, false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    const { id } = deleteTarget
    markPending(id, true)
    setDeleteTarget(null)

    try {
      const res = await fetch(`/api/sell/listing/${id}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        showToast(data.error ?? 'Error al eliminar.', 'error')
      } else {
        setListings((prev) => prev.filter((l) => l.id !== id))
        showToast('Anuncio eliminado.', 'success')
      }
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      markPending(id, false)
    }
  }

  return (
    <div>
      {bulkFlagEnabled && selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalFiltered={totalFiltered}
          allVisibleSelected={selectedIds.size === listings.length}
          filterParams={filterParams}
          selectedIds={[...selectedIds]}
          onStaged={(batchId) => setBatchInUrl(batchId)}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      <div className="overflow-x-auto border border-[var(--color-border)] rounded-xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {bulkFlagEnabled && (
              <th className="p-3 font-medium w-8">
                <input
                  type="checkbox"
                  checked={listings.length > 0 && selectedIds.size === listings.length}
                  onChange={toggleSelectAllVisible}
                  aria-label="Seleccionar todos los visibles"
                />
              </th>
            )}
            <th className="p-3 font-medium">Producto</th>
            <th className="p-3 font-medium">SKU</th>
            <th className="p-3 font-medium">Precio</th>
            <th className="p-3 font-medium">Stock</th>
            <th className="p-3 font-medium">Canales</th>
            {profitFlagEnabled && (
              <th className="p-3 font-medium">
                <button
                  type="button"
                  onClick={() => setMarginSort((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? 'none' : 'asc'))}
                  className="flex items-center gap-1 normal-case font-medium hover:underline"
                  title="Ordena solo los anuncios de esta página — el margen no está indexado para ordenar en todo el catálogo"
                >
                  Margen (esta página)
                  {marginSort === 'asc' && ' ↑'}
                  {marginSort === 'desc' && ' ↓'}
                </button>
              </th>
            )}
            <th className="p-3 font-medium">Estado</th>
            <th className="p-3 font-medium sr-only">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {displayedListings.map((listing) => {
            const status = deriveCatalogStatus(listing)
            const meta = STATUS_LABEL[status]
            const badges = deriveChannelBadges(listing)
            const thumb = listing.images?.[0]?.url
            const isPending = pendingIds.has(listing.id)
            const canToggle = status === 'activo' || status === 'agotado' || status === 'pausado'
            const nextStatus = status === 'pausado' ? 'active' : 'paused'
            const margin = marginByProduct.get(listing.id)
            return (
              <tr key={listing.id} className={`border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] ${isPending ? 'opacity-60' : ''}`}>
                {bulkFlagEnabled && (
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(listing.id)}
                      onChange={() => toggleSelect(listing.id)}
                      aria-label={`Seleccionar ${listing.title}`}
                    />
                  </td>
                )}
                <td className="p-3">
                  <Link href={`/sell/edit/${listing.id}`} className="flex items-center gap-3 no-underline text-[var(--color-foreground)]">
                    <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg">📦</div>
                      )}
                    </div>
                    <span className="font-medium truncate max-w-[240px]">{listing.title}</span>
                  </Link>
                </td>
                <td className="p-3 text-[var(--color-muted)]">{listing.sku ?? '—'}</td>
                <td className="p-3 font-semibold whitespace-nowrap">
                  {formatPrice(listing.price_cents, listing.currency)}
                  {listing.ml_price_cents != null && listing.ml_price_cents !== listing.price_cents && (
                    <div className="text-xs font-normal text-[var(--color-muted)]">
                      ML: {formatPrice(listing.ml_price_cents, listing.currency)}
                    </div>
                  )}
                </td>
                <td className="p-3 whitespace-nowrap">{stockLabel(listing)}</td>
                <td className="p-3">
                  <div className="flex gap-1 flex-wrap items-center">
                    {badges.miyagi && <span className="badge badge-soft">Miyagi</span>}
                    {badges.ml && <span className="badge badge-soft">ML</span>}
                    {channelsFlagEnabled && (
                      <button
                        type="button"
                        onClick={() => handleMiyagiToggle(listing)}
                        disabled={isPending}
                        title={listing.miyagi_visible !== false
                          ? 'Ocultar del marketplace Miyagi (sigue en tu tienda)'
                          : 'Mostrar en el marketplace Miyagi'}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
                      >
                        {listing.miyagi_visible !== false ? 'Ocultar Miyagi' : 'Mostrar Miyagi'}
                      </button>
                    )}
                    {channelsFlagEnabled && (
                      <button
                        type="button"
                        onClick={() => handleMlToggle(listing)}
                        disabled={isPending || !mlEntitled}
                        title={!mlEntitled ? 'Requiere la integración de Mercado Libre' : undefined}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
                      >
                        {badges.ml ? 'Quitar de ML' : 'Publicar en ML'}
                      </button>
                    )}
                  </div>
                </td>
                {profitFlagEnabled && (
                  <td className="p-3">
                    {margin && (
                      <div className="flex flex-col gap-0.5">
                        <MarginCellDisplay label="Miyagi" cell={margin.miyagi} />
                        {badges.ml && <MarginCellDisplay label="ML" cell={margin.ml} />}
                      </div>
                    )}
                  </td>
                )}
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>{meta.label}</span>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1 justify-end">
                    {canToggle && (
                      <button
                        type="button"
                        onClick={() => handleToggle(listing, nextStatus)}
                        disabled={isPending}
                        title={status === 'pausado' ? 'Activar anuncio' : 'Pausar anuncio'}
                        className="p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] disabled:opacity-50"
                        aria-label={status === 'pausado' ? 'Activar' : 'Pausar'}
                      >
                        <i className={status === 'pausado' ? 'iconoir-play' : 'iconoir-pause'} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(listing)}
                      disabled={isPending}
                      title="Eliminar anuncio"
                      className="p-1.5 rounded hover:bg-red-50 hover:text-red-600 text-[var(--color-muted)] disabled:opacity-50"
                      aria-label="Eliminar"
                    >
                      <i className="iconoir-trash" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {deleteTarget && (
        <DeleteDialog
          listing={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          pending={pendingIds.has(deleteTarget.id)}
        />
      )}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
      </div>

      {activeBatchId && (
        <BulkDiffPreview
          batchId={activeBatchId}
          onClose={() => setBatchInUrl(null)}
          onApplied={() => {
            setSelectedIds(new Set())
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
