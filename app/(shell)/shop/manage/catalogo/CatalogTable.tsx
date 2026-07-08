'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { deriveCatalogStatus } from '@/lib/catalog-status'

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
  in_stock: boolean
  channels: string[]
  images: Array<{ url: string; alt?: string | null }>
  created_at: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  activo: { label: 'Activo', color: 'bg-green-100 text-green-700' },
  pausado: { label: 'Pausado', color: 'bg-amber-100 text-amber-700' },
  borrador: { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  agotado: { label: 'Agotado', color: 'bg-red-100 text-red-600' },
}

function formatPrice(cents: number | null, currency: string) {
  if (cents === null) return 'Precio a convenir'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function stockLabel(listing: CatalogListing) {
  if (!listing.manage_inventory) return 'Sin límite'
  if (!listing.in_stock) return 'Agotado'
  return `${listing.available_quantity ?? 0} disponibles`
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

export default function CatalogTable({ listings: initialListings }: { listings: CatalogListing[] }) {
  const [listings, setListings] = useState(initialListings)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CatalogListing | null>(null)

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
    <div className="overflow-x-auto border border-[var(--color-border)] rounded-xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <th className="p-3 font-medium">Producto</th>
            <th className="p-3 font-medium">SKU</th>
            <th className="p-3 font-medium">Precio</th>
            <th className="p-3 font-medium">Stock</th>
            <th className="p-3 font-medium">Canales</th>
            <th className="p-3 font-medium">Estado</th>
            <th className="p-3 font-medium sr-only">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => {
            const status = deriveCatalogStatus(listing)
            const meta = STATUS_LABEL[status]
            const thumb = listing.images?.[0]?.url
            const isPending = pendingIds.has(listing.id)
            const canToggle = status === 'activo' || status === 'agotado' || status === 'pausado'
            const nextStatus = status === 'pausado' ? 'active' : 'paused'
            return (
              <tr key={listing.id} className={`border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] ${isPending ? 'opacity-60' : ''}`}>
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
                <td className="p-3 font-semibold whitespace-nowrap">{formatPrice(listing.price_cents, listing.currency)}</td>
                <td className="p-3 whitespace-nowrap">{stockLabel(listing)}</td>
                <td className="p-3">
                  <div className="flex gap-1 flex-wrap">
                    {/* Deploy-lag safety: backend Cloud Run has no per-branch preview, so a
                        moment can exist where this page is live before the backend's `channels`
                        field is — degrade to the always-true Miyagi badge rather than throw. */}
                    {(listing.channels ?? ['miyagi']).includes('miyagi') && <span className="badge badge-soft">Miyagi</span>}
                    {(listing.channels ?? []).includes('ml') && <span className="badge badge-soft">ML</span>}
                  </div>
                </td>
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
  )
}
