'use client'

import { useState } from 'react'
import Link from 'next/link'
import { manualPaymentStateFromOrder, manualPaymentBadge, whoActsNext } from '@/lib/manual-payment-state'

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

const STATUS_META: Record<string, { label: string; badge: string; dot: string }> = {
  pending_payment: { label: 'Pago pendiente', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  paid:       { label: 'Nuevo',       badge: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  processing: { label: 'Procesando',  badge: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  shipped:    { label: 'Enviado',      badge: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  in_transit: { label: 'En camino',   badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  delivered:  { label: 'Entregado',   badge: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
  completed:  { label: 'Completado',  badge: 'bg-gray-100 text-gray-500',    dot: 'bg-gray-400' },
  refunded:   { label: 'Reembolsado', badge: 'bg-red-100 text-red-600',      dot: 'bg-red-500' },
  fulfilled:  { label: 'Entregado',   badge: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
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

function OrderCard({ order }: { order: Order }) {
  const listing  = getListing(order)
  const shipment = getShipment(order)
  const thumb    = listing?.images?.[0]?.url ?? null
  const meta     = STATUS_META[order.status] ?? STATUS_META.paid
  const urgent   = needsAction(order)
  // Manual-payment lifecycle: an unconfirmed manual order is pending OR reported —
  // never "ready to ship". The badge/footer reflect whose move it is.
  const manualState = manualPaymentStateFromOrder(order)
  const isUnpaidManual = manualState === 'pending_payment' || manualState === 'buyer_reported_paid'
  const badgeLabel = manualState === 'buyer_reported_paid' ? manualPaymentBadge(manualState) : meta.label

  return (
    <Link
      href={`/shop/manage/orders/${order.id}`}
      className={`no-underline block rounded-xl border transition-all hover:shadow-sm ${
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
            <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.badge}`}>
              {badgeLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-text)]">
              {formatPrice(order.amount_cents, order.currency)}
            </span>
            <span>{order.buyer_name ?? 'Comprador'}</span>
            <span>{relativeDate(order.created_at)}</span>
          </div>

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
  const [filter, setFilter] = useState<FilterTab>('pending')

  // Compute counts per tab
  const needsActionOrders = initialOrders.filter(o => needsAction(o))
  const shippedOrders     = initialOrders.filter(o => ['shipped', 'in_transit'].includes(o.status))
  const deliveredOrders   = initialOrders.filter(o => ['delivered', 'completed', 'fulfilled'].includes(o.status))

  const displayedOrders = filter === 'pending'
    ? needsActionOrders
    : filter === 'shipped'
      ? shippedOrders
      : filter === 'delivered'
        ? deliveredOrders
        : initialOrders

  const tabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'pending',   label: 'Por enviar',  count: needsActionOrders.length },
    { key: 'shipped',   label: 'Enviados',    count: shippedOrders.length },
    { key: 'delivered', label: 'Entregados',  count: deliveredOrders.length },
    { key: 'all',       label: 'Todos',       count: initialOrders.length },
  ]

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
        <Link href="/shop/manage" className="hover:text-[var(--color-text)] no-underline">Mi tienda</Link>
        <span>›</span>
        <span>Pedidos</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <Link href="/shop/manage" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline">
          ← Panel
        </Link>
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
            <OrderCard key={order.id} order={order} />
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
