'use client'

import { useState } from 'react'
import Link from 'next/link'
import { carrierLabel } from '@/lib/envia'

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
  marketplace_listings:
    | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string }
    | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string }[]
  marketplace_shops:
    | { id: string; name: string; slug: string }
    | { id: string; name: string; slug: string }[]
  marketplace_shipments: OrderShipment[] | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; badge: string; icon: string }> = {
  pending_payment: { label: 'Pago pendiente', badge: 'bg-amber-100 text-amber-700', icon: '⏳' },
  paid:       { label: 'Pago confirmado',  badge: 'bg-green-100 text-green-700',   icon: '✓' },
  processing: { label: 'Preparando envío', badge: 'bg-blue-100 text-blue-700',     icon: '📋' },
  shipped:    { label: 'Enviado',           badge: 'bg-indigo-100 text-indigo-700', icon: '📦' },
  in_transit: { label: 'En camino',        badge: 'bg-purple-100 text-purple-700', icon: '🚚' },
  delivered:  { label: 'Entregado',        badge: 'bg-green-100 text-green-700',   icon: '✓' },
  completed:  { label: 'Completado',       badge: 'bg-gray-100 text-gray-500',     icon: '✓' },
  refunded:   { label: 'Reembolsado',      badge: 'bg-red-100 text-red-600',       icon: '↩' },
  fulfilled:  { label: 'Descarga lista',   badge: 'bg-green-100 text-green-700',   icon: '⬇' },
}

const ACTIVE_STATUSES   = new Set(['pending_payment', 'paid', 'processing', 'shipped', 'in_transit'])
const COMPLETE_STATUSES = new Set(['delivered', 'completed', 'fulfilled', 'refunded'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function getListing(order: Order) {
  const l = order.marketplace_listings
  return Array.isArray(l) ? l[0] : l
}

function getShop(order: Order) {
  const s = order.marketplace_shops
  return Array.isArray(s) ? s[0] : s
}

function getShipment(order: Order): OrderShipment | null {
  return order.marketplace_shipments?.[0] ?? null
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: Order }) {
  const listing  = getListing(order)
  const shop     = getShop(order)
  const shipment = getShipment(order)
  const thumb    = listing?.images?.[0]?.url ?? null
  const meta     = STATUS_META[order.status] ?? STATUS_META.paid
  const active   = ACTIVE_STATUSES.has(order.status)

  return (
    <Link
      href={`/account/orders/${order.id}`}
      className={`no-underline block rounded-xl border transition-all hover:shadow-sm ${
        active
          ? 'border-[var(--color-border)] hover:border-[var(--color-accent)] bg-white'
          : 'border-[var(--color-border)] bg-white opacity-90 hover:opacity-100'
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
            <p className="text-sm font-semibold leading-snug text-[var(--color-text)] line-clamp-1">
              {listing?.title ?? '—'}
            </p>
            <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.badge}`}>
              {meta.label}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-text)]">
              {formatPrice(order.amount_cents, order.currency)}
            </span>
            {shop && (
              <span>{shop.name}</span>
            )}
            <span>{formatDate(order.created_at)}</span>
          </div>

          {/* Tracking chip */}
          {shipment?.tracking_number && (
            <p className="mt-1.5 text-[11px] text-[var(--color-muted)] flex items-center gap-1">
              <span>🚚</span>
              <span>{carrierLabel(shipment.carrier)}</span>
              <span className="font-mono">· {shipment.tracking_number}</span>
            </p>
          )}
        </div>

        <span className="text-[var(--color-muted)] text-lg flex-shrink-0 self-center">›</span>
      </div>

      {/* In-transit progress bar */}
      {(order.status === 'shipped' || order.status === 'in_transit') && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between text-[10px] text-[var(--color-muted)] mb-1">
            <span>Pagado</span>
            <span>Enviado</span>
            <span>Entregado</span>
          </div>
          <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
            <div className={`h-full rounded-full bg-[var(--color-accent)] transition-all ${
              order.status === 'shipped' ? 'w-2/3' : 'w-5/6'
            }`} />
          </div>
        </div>
      )}
    </Link>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FilterTab = 'active' | 'completed'

export default function AccountOrdersClient({ orders }: { orders: Order[] }) {
  const [filter, setFilter] = useState<FilterTab>('active')

  const activeOrders   = orders.filter(o => ACTIVE_STATUSES.has(o.status))
  const completeOrders = orders.filter(o => COMPLETE_STATUSES.has(o.status))
  const displayed      = filter === 'active' ? activeOrders : completeOrders

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Mis compras</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          {orders.length} compra{orders.length !== 1 ? 's' : ''} en total
        </p>
      </div>

      {/* Active order highlight */}
      {activeOrders.length > 0 && filter === 'active' && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5">
          <span className="text-lg">🚚</span>
          <p className="text-sm text-blue-800">
            Tienes <strong>{activeOrders.length} pedido{activeOrders.length > 1 ? 's' : ''}</strong> en proceso.
          </p>
        </div>
      )}

      {/* Filter tabs */}
      {orders.length > 0 && (
        <div className="flex gap-1 mb-5 border border-[var(--color-border)] rounded-lg p-1 w-fit">
          {([
            { key: 'active',    label: 'En proceso', count: activeOrders.length },
            { key: 'completed', label: 'Completados', count: completeOrders.length },
          ] as const).map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
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

      {/* Orders */}
      {displayed.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-[var(--color-border)] rounded-xl">
          {filter === 'active' && orders.length > 0 ? (
            <>
              <div className="text-4xl mb-3">✓</div>
              <h3 className="font-semibold text-lg mb-1">Sin pedidos activos</h3>
              <p className="text-sm text-[var(--color-muted)]">Todos tus pedidos han sido entregados.</p>
              <button type="button" onClick={() => setFilter('completed')}
                className="mt-3 text-sm text-[var(--color-accent)] underline">
                Ver historial
              </button>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">🛍️</div>
              <h3 className="font-semibold text-lg mb-1">Aún no has comprado nada</h3>
              <p className="text-sm text-[var(--color-muted)] mb-5 max-w-xs mx-auto">
                Explora miles de productos de vendedores locales en México.
              </p>
              <Link href="/l"
                className="inline-block bg-[var(--color-accent)] text-white px-6 py-2.5 rounded-lg font-medium no-underline hover:bg-[var(--color-accent-hover)] transition-colors">
                Explorar productos
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {displayed.map(order => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}

      {/* Account nav links */}
      <div className="mt-8 pt-6 border-t border-[var(--color-border)] flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
        <Link href="/account/subscriptions" className="hover:text-[var(--color-text)] no-underline">Mis suscripciones</Link>
        <Link href="/account/favorites" className="hover:text-[var(--color-text)] no-underline">Guardados</Link>
      </div>
    </div>
  )
}
