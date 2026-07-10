'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import { manualPaymentStateFromOrder, manualPaymentBadge, whoActsNext } from '@/lib/manual-payment-state'
import { mlOrderBadgeLabel } from '@/lib/ml-order-badge'
import { orderStatusToToken } from '@/lib/status-badge'
import { StatusBadge } from '@/components/ui/StatusBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderShipment {
  id: string
  carrier: string
  tracking_number: string | null
  status: string
  estimated_delivery_date: string | null
}

interface Order {
  id: string
  status: string
  amount_cents: number
  currency: string
  shipping_method: string
  buyer_name: string | null
  buyer_email: string | null
  created_at: string
  updated_at: string
  // Durable manual-payment lifecycle (curated top-level normalized fields).
  payment_method?: string | null
  payment_received?: boolean
  buyer_reported_paid?: boolean
  manual_payment_state?: string | null
  // Which marketplace sold this (ml-orders-native S1 · US-3).
  source?: string | null
  ml_order_id?: string | null
  ml_pack_id?: string | null
  // Free-form seller tags (ml-orders-native S3 · US-7).
  tags?: string[] | null
  marketplace_listings: { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string }
    | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string }[]
  marketplace_shipments: OrderShipment[] | null
}

interface Shop {
  id: string
  slug: string
  name: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

type FilterTab = 'pending' | 'shipped' | 'delivered' | 'all'

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Pago pendiente',
  paid: 'Nuevo',
  processing: 'Procesando',
  shipped: 'Enviado',
  in_transit: 'En camino',
  delivered: 'Entregado',
  completed: 'Completado',
  refunded: 'Reembolsado',
  fulfilled: 'Entregado',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function relativeDate(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  < 60)  return `Hace ${mins}m`
  if (hours < 24)  return `Hace ${hours}h`
  if (days  < 30)  return `Hace ${days} día${days > 1 ? 's' : ''}`
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

function getListing(order: Order) {
  const l = order.marketplace_listings
  return Array.isArray(l) ? l[0] : l
}

function getShipment(order: Order): OrderShipment | null {
  return order.marketplace_shipments?.[0] ?? null
}

function needsAction(order: Order) {
  return order.status === 'pending_payment' || order.status === 'paid' || order.status === 'processing'
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  selected,
  onToggleSelect,
}: {
  order: Order
  selected: boolean
  onToggleSelect: () => void
}) {
  const listing  = getListing(order)
  const shipment = getShipment(order)
  const thumb    = listing?.images?.[0]?.url ?? null
  const statusLabel = STATUS_LABEL[order.status] ?? STATUS_LABEL.paid
  const statusToken  = orderStatusToToken(order.status)
  const urgent   = needsAction(order)
  // Manual-payment lifecycle: an unconfirmed manual order is pending OR reported —
  // never "ready to ship". The badge/footer reflect whose move it is.
  const manualState = manualPaymentStateFromOrder(order)
  const isUnpaidManual = manualState === 'pending_payment' || manualState === 'buyer_reported_paid'
  const badgeLabel = manualState === 'buyer_reported_paid' ? manualPaymentBadge(manualState) : statusLabel
  const mlBadge = mlOrderBadgeLabel(order)

  return (
    <div className="flex items-center gap-2">
      {/* Bulk-select checkbox (ml-orders-native S3 · US-8) — outside the Link so
          it never triggers navigation. */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Seleccionar pedido ${order.id}`}
        className="flex-shrink-0 w-4 h-4"
      />
      <Link
        href={`/shop/manage/orders/${order.id}`}
        className={`no-underline block flex-1 min-w-0 rounded-xl border transition-all hover:shadow-sm ${
          urgent
            ? 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
            : 'border-[var(--color-border)] bg-white hover:border-[var(--color-accent)]'
        }`}
      >
      <div className="flex items-start gap-3 p-4">
        {/* Thumbnail */}
        <div className="w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          {thumb
            ? <img src={thumb} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
          }
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <p className="text-sm font-semibold leading-snug truncate text-[var(--color-text)]">
              {listing?.title ?? '—'}
            </p>
            <span className="flex-shrink-0 flex items-center gap-1">
              {mlBadge && <StatusBadge token="promo">{mlBadge}</StatusBadge>}
              <StatusBadge token={statusToken}>{badgeLabel}</StatusBadge>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-text)]">
              {formatPrice(order.amount_cents, order.currency)}
            </span>
            <span>{order.buyer_name ?? 'Comprador'}</span>
            <span>{relativeDate(order.created_at)}</span>
          </div>

          {/* Tag chips */}
          {order.tags && order.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {order.tags.map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-subtle)] text-[var(--color-muted)]">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Shipment tracking chip */}
          {shipment?.tracking_number && (
            <p className="mt-1.5 text-[11px] text-[var(--color-muted)] flex items-center gap-1">
              <span>🚚</span>
              <span className="font-mono">{shipment.tracking_number}</span>
              <span>· {shipment.carrier.toUpperCase()}</span>
            </p>
          )}
        </div>

        {/* Arrow */}
        <span className="text-[var(--color-muted)] text-lg flex-shrink-0 self-center">›</span>
      </div>

      {/* Urgency footer */}
      {urgent && (
        <div className="border-t border-amber-200 px-4 py-2 flex items-center gap-2">
          <span className="text-amber-500 text-sm">⚡</span>
          <p className="text-xs text-amber-700 font-medium">
            {isUnpaidManual
              ? whoActsNext(manualState!, 'seller')
              : order.status === 'paid' ? 'Confirma y prepara el envío' : 'Listo para enviar'}
          </p>
          <span className="ml-auto text-xs text-amber-600 font-semibold">Ver →</span>
        </div>
      )}
      </Link>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrdersInbox({
  shop,
  initialOrders,
}: {
  shop: Shop
  initialOrders: Order[]
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)

  // Compute counts per tab
  const needsActionOrders = initialOrders.filter(o => needsAction(o))
  const shippedOrders     = initialOrders.filter(o => ['shipped', 'in_transit'].includes(o.status))
  const deliveredOrders   = initialOrders.filter(o => ['delivered', 'completed', 'fulfilled'].includes(o.status))

  const statusFilteredOrders = filter === 'pending'
    ? needsActionOrders
    : filter === 'shipped'
      ? shippedOrders
      : filter === 'delivered'
        ? deliveredOrders
        : initialOrders

  // All distinct tags across every order (client-side — no pagination on this page).
  const allTags = useMemo(() => {
    const seen = new Set<string>()
    for (const o of initialOrders) for (const t of o.tags ?? []) seen.add(t)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [initialOrders])

  const displayedOrders = tagFilter
    ? statusFilteredOrders.filter(o => (o.tags ?? []).includes(tagFilter))
    : statusFilteredOrders

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Bulk fulfillment-status action (ml-orders-native S3 · US-8). Status-only
  // transitions (no bulk carrier/tracking entry) — mixed ML + native selections
  // work with zero special-casing (the backend endpoint is source-agnostic).
  async function handleBulkStatus(status: 'processing' | 'shipped' | 'delivered') {
    if (selected.size === 0) return
    setBulkBusy(true)
    setBulkMessage(null)
    try {
      const res = await fetch('/api/orders/bulk-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ids: Array.from(selected), status }),
      })
      const data = await res.json() as {
        advanced?: string[]
        skipped?: Array<{ order_id: string; reason: string }>
        error?: string
      }
      if (!res.ok) {
        setBulkMessage(data.error ?? 'Error al actualizar pedidos.')
        return
      }
      const advancedCount = data.advanced?.length ?? 0
      const skipped = data.skipped ?? []
      let msg = `${advancedCount} pedido${advancedCount !== 1 ? 's' : ''} actualizado${advancedCount !== 1 ? 's' : ''}.`
      if (skipped.length) {
        const reasons = skipped.slice(0, 3).map(s => s.reason).join('; ')
        msg += ` ${skipped.length} sin cambios: ${reasons}${skipped.length > 3 ? '…' : ''}`
      }
      setBulkMessage(msg)
      setSelected(new Set())
      router.refresh()
    } catch {
      setBulkMessage('Sin conexión.')
    } finally {
      setBulkBusy(false)
    }
  }

  const tabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'pending',   label: 'Por enviar',  count: needsActionOrders.length },
    { key: 'shipped',   label: 'Enviados',    count: shippedOrders.length },
    { key: 'delivered', label: 'Entregados',  count: deliveredOrders.length },
    { key: 'all',       label: 'Todos',       count: initialOrders.length },
  ]

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <SellerBreadcrumb className="mb-6" />

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Pedidos</h1>
      </div>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        {initialOrders.length} pedido{initialOrders.length !== 1 ? 's' : ''} en total
      </p>

      {/* Urgency nudge */}
      {needsActionOrders.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <span className="text-lg mt-0.5">⚡</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {needsActionOrders.length} pedido{needsActionOrders.length > 1 ? 's' : ''} esperando tu acción
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Los compradores que no reciben actualizaciones en 24 h califican más bajo. Envía rápido.
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {initialOrders.length > 0 && (
        <div className="flex gap-1 mb-5 border border-[var(--color-border)] rounded-lg p-1 w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filter === t.key
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-bold ${
                  filter === t.key ? 'bg-white/25' : 'bg-[var(--color-border)] text-[var(--color-muted)]'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tag filter (ml-orders-native S3 · US-7) */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {allTags.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(prev => (prev === tag ? null : tag))}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                tagFilter === tag
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-subtle)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Bulk action bar (ml-orders-native S3 · US-8) */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 bg-[var(--color-accent)] text-white rounded-xl px-4 py-2.5 mb-4">
          <span className="text-sm font-medium">
            {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
          </span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            <button type="button" disabled={bulkBusy} onClick={() => handleBulkStatus('processing')}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50">
              Procesando
            </button>
            <button type="button" disabled={bulkBusy} onClick={() => handleBulkStatus('shipped')}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50">
              Enviado
            </button>
            <button type="button" disabled={bulkBusy} onClick={() => handleBulkStatus('delivered')}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50">
              Entregado
            </button>
            <button type="button" disabled={bulkBusy} onClick={() => setSelected(new Set())}
              className="text-xs font-medium px-2 py-1 rounded-lg hover:bg-white/10">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {bulkMessage && (
        <div className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2 mb-4">
          {bulkMessage}
        </div>
      )}

      {/* Orders list */}
      {displayedOrders.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-[var(--color-border)] rounded-xl">
          {filter === 'pending' && initialOrders.length > 0 ? (
            <>
              <div className="text-4xl mb-3">✓</div>
              <h3 className="font-semibold text-lg mb-1">¡Al día!</h3>
              <p className="text-sm text-[var(--color-muted)]">No tienes pedidos pendientes de enviar.</p>
              <button type="button" onClick={() => setFilter('all')}
                className="mt-3 text-sm text-[var(--color-accent)] underline">
                Ver historial
              </button>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">📦</div>
              <h3 className="font-semibold text-lg mb-1">Sin pedidos aún</h3>
              <p className="text-sm text-[var(--color-muted)] mb-4 max-w-xs mx-auto">
                Cuando los compradores paguen tus productos, aparecerán aquí.
              </p>
              <Link href={`/s/${shop.slug}`}
                className="text-sm text-[var(--color-accent)] no-underline hover:underline">
                Ver tu tienda →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {displayedOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              selected={selected.has(order.id)}
              onToggleSelect={() => toggleSelect(order.id)}
            />
          ))}
        </div>
      )}

      {/* AI tip */}
      {initialOrders.length > 0 && (
        <div className="mt-8 flex items-start gap-3 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl px-4 py-3">
          <span className="text-base mt-0.5">✦</span>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            <strong className="text-[var(--color-text)]">Tip:</strong> Los vendedores que envían en menos de 24 h
            reciben un 23% más de reseñas positivas. Responder rápido construye reputación.
          </p>
        </div>
      )}
    </div>
  )
}
