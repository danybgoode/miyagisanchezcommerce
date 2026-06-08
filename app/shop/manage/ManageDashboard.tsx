'use client'

import { useState, useTransition, useCallback } from 'react'
import Link from 'next/link'
import PrintEditionCard from './PrintEditionCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManagedListing {
  id: string
  title: string
  price_cents: number | null
  currency: string
  category: string | null
  listing_type: string
  condition: string | null
  status: string
  views: number
  images: Array<{ url: string; alt?: string }>
  created_at: string
}

interface Shop {
  id: string
  slug: string
  name: string
  location: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number | null, currency: string) {
  if (cents === null) return 'Precio a convenir'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function relativeDate(iso: string) {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 30) return `Hace ${days} días`
  const months = Math.floor(days / 30)
  return `Hace ${months} mes${months > 1 ? 'es' : ''}`
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:  { label: 'Activo',  color: 'bg-green-100 text-green-700' },
  paused:  { label: 'Pausado', color: 'bg-amber-100 text-amber-700' },
  draft:   { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  deleted: { label: 'Eliminado', color: 'bg-red-100 text-red-600' },
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState { message: string; type: 'success' | 'error' }

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100" aria-label="Cerrar">×</button>
    </div>
  )
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

function DeleteDialog({
  listing,
  onConfirm,
  onCancel,
  pending,
}: {
  listing: ManagedListing
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
          <button
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2 rounded border border-[var(--color-border)] text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Listing row ───────────────────────────────────────────────────────────────

function ListingRow({
  listing,
  onToggleStatus,
  onDelete,
  isPending,
}: {
  listing: ManagedListing
  onToggleStatus: (id: string, next: 'active' | 'paused') => void
  onDelete: (listing: ManagedListing) => void
  isPending: boolean
}) {
  const thumb = listing.images?.[0]?.url
  const meta = STATUS_LABEL[listing.status] ?? STATUS_LABEL.draft
  const nextStatus = listing.status === 'active' ? 'paused' : 'active'

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] transition-colors ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Thumbnail */}
      <div className="w-16 h-16 flex-shrink-0 rounded overflow-hidden bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/l/${listing.id}`}
            className="font-medium text-sm leading-snug truncate hover:text-[var(--color-accent)] no-underline"
          >
            {listing.title}
          </Link>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${meta.color}`}>
            {meta.label}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-muted)]">
          <span className="font-semibold text-[var(--color-foreground)]">
            {formatPrice(listing.price_cents, listing.currency)}
          </span>
          {listing.category && <span>{listing.category}</span>}
          <span>👁 {listing.views} vista{listing.views !== 1 ? 's' : ''}</span>
          <span>{relativeDate(listing.created_at)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Toggle pause/activate */}
        {(listing.status === 'active' || listing.status === 'paused') && (
          <button
            type="button"
            onClick={() => onToggleStatus(listing.id, nextStatus as 'active' | 'paused')}
            title={listing.status === 'active' ? 'Pausar anuncio' : 'Activar anuncio'}
            className="p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] transition-colors"
            aria-label={listing.status === 'active' ? 'Pausar' : 'Activar'}
          >
            {listing.status === 'active' ? (
              // Pause icon
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              // Play icon
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
        )}

        {/* Edit */}
        <Link
          href={`/sell/edit/${listing.id}`}
          title="Editar anuncio"
          className="p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] transition-colors no-underline"
          aria-label="Editar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </Link>

        {/* Delete */}
        <button
          type="button"
          onClick={() => onDelete(listing)}
          title="Eliminar anuncio"
          className="p-1.5 rounded hover:bg-red-50 hover:text-red-600 text-[var(--color-muted)] transition-colors"
          aria-label="Eliminar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManageDashboard({
  shop,
  initialListings,
  pendingOffersCount = 0,
  pendingOrdersCount = 0,
}: {
  shop: Shop
  initialListings: ManagedListing[]
  pendingOffersCount?: number
  pendingOrdersCount?: number
}) {
  const [listings, setListings] = useState(initialListings)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedListing | null>(null)
  const [, startTransition] = useTransition()

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const markPending = (id: string, on: boolean) =>
    setPendingIds(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // ── Toggle status ───────────────────────────────────────────────────────────
  async function handleToggle(id: string, next: 'active' | 'paused') {
    markPending(id, true)
    // Optimistic update
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: next } : l))

    try {
      const res = await fetch(`/api/sell/listing/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        // Revert on failure
        setListings(prev => prev.map(l => l.id === id ? { ...l, status: next === 'active' ? 'paused' : 'active' } : l))
        showToast(data.error ?? 'Error al cambiar el estado.', 'error')
      } else {
        showToast(next === 'active' ? 'Anuncio activado.' : 'Anuncio pausado.', 'success')
      }
    } catch {
      setListings(prev => prev.map(l => l.id === id ? { ...l, status: next === 'active' ? 'paused' : 'active' } : l))
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      markPending(id, false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
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
        startTransition(() => {
          setListings(prev => prev.filter(l => l.id !== id))
        })
        showToast('Anuncio eliminado.', 'success')
      }
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      markPending(id, false)
    }
  }

  // ── Derived stats ───────────────────────────────────────────────────────────
  const totalViews = listings.reduce((s, l) => s + (l.views ?? 0), 0)
  const activeCount = listings.filter(l => l.status === 'active').length
  const pausedCount = listings.filter(l => l.status === 'paused').length

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">

      {/* ── Shop header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{shop.name}</h1>
          {shop.location && (
            <p className="text-sm text-[var(--color-muted)] mt-0.5">📍 {shop.location}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <Link
              href={`/s/${shop.slug}`}
              className="text-xs text-[var(--color-accent)] hover:underline no-underline"
              target="_blank"
            >
              Ver tienda pública ↗
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/orders"
              className="relative text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline inline-flex items-center gap-1"
            >
              Pedidos
              {pendingOrdersCount > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {pendingOrdersCount}
                </span>
              )}
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/offers"
              className="relative text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline inline-flex items-center gap-1"
            >
              Ofertas
              {pendingOffersCount > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {pendingOffersCount}
                </span>
              )}
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/subscriptions"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Suscripciones
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/content"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Contenido
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/promotions"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Cupones
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/sweepstakes"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Sorteos
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/eventos"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Eventos
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/analytics"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Analíticas
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/settings"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Configuración
            </Link>
            <span className="text-[var(--color-border)]">·</span>
            <Link
              href="/shop/manage/import"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
            >
              Importar catálogo
            </Link>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          <Link
            href="/shop/manage/import"
            className="hidden sm:inline-block border border-[var(--border)] text-[var(--fg)] px-3 py-2 rounded-lg text-sm font-semibold no-underline hover:bg-[var(--surface-muted)] transition-colors"
          >
            Importar
          </Link>
          <Link
            href="/sell"
            className="bg-[var(--accent)] text-[var(--fg-inverse)] px-4 py-2 rounded-lg text-sm font-semibold no-underline hover:bg-[var(--accent-hover)] transition-colors"
          >
            + Nuevo anuncio
          </Link>
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Activos', value: activeCount, color: 'text-green-600' },
          { label: 'Pausados', value: pausedCount, color: 'text-amber-600' },
          { label: 'Vistas totales', value: totalViews, color: 'text-[var(--color-foreground)]' },
        ].map(stat => (
          <div key={stat.label} className="border border-[var(--color-border)] rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value.toLocaleString('es-MX')}</div>
            <div className="text-xs text-[var(--color-muted)] mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── Print edition power-up ──────────────────────────────────────────── */}
      <PrintEditionCard />

      {/* ── Listings ────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-[var(--color-muted)] uppercase tracking-wide">
            Mis anuncios ({listings.length})
          </h2>
        </div>

        {listings.length === 0 ? (
          /* Empty state */
          <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-12 text-center">
            <div className="text-4xl mb-3">📦</div>
            <h3 className="font-semibold mb-1">No tienes anuncios publicados</h3>
            <p className="text-sm text-[var(--color-muted)] mb-5">
              Publica tu primer producto, servicio o renta en menos de 2 minutos.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sell"
                className="inline-block bg-[var(--accent)] text-[var(--fg-inverse)] px-6 py-2.5 rounded-lg font-medium no-underline hover:bg-[var(--accent-hover)] transition-colors"
              >
                Publicar primer anuncio
              </Link>
              <Link
                href="/shop/manage/import"
                className="inline-block border border-[var(--border)] text-[var(--fg)] px-6 py-2.5 rounded-lg font-medium no-underline hover:bg-[var(--surface-muted)] transition-colors"
              >
                ¿Te cambias? Importa tu catálogo
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {listings.map(listing => (
              <ListingRow
                key={listing.id}
                listing={listing}
                onToggleStatus={handleToggle}
                onDelete={setDeleteTarget}
                isPending={pendingIds.has(listing.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Trust footer ────────────────────────────────────────────────────── */}
      <p className="text-xs text-center text-[var(--color-muted)] mt-10">
        ✓ Sin comisiones · ✓ Publicación instantánea · ✓ 100% gratis
      </p>

      {/* ── Delete confirmation dialog ───────────────────────────────────────── */}
      {deleteTarget && (
        <DeleteDialog
          listing={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          pending={pendingIds.has(deleteTarget.id)}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
