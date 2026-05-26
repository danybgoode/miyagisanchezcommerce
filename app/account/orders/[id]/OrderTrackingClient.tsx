'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { carrierLabel, carrierTrackingUrl } from '@/lib/envia'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shipment {
  id: string
  carrier: string
  tracking_number: string | null
  label_url: string | null
  status: string
  estimated_delivery_date: string | null
  created_at: string
}

interface OrderTrackingProps {
  order: {
    id: string
    status: string
    amount_cents: number
    currency: string
    shipping_method: string
    shipping_address: Record<string, string> | null
    buyer_name: string | null
    buyer_email: string | null
    created_at: string
    marketplace_listings:
      | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string }
      | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string }[]
    marketplace_shops:
      | { id: string; name: string; slug: string }
      | { id: string; name: string; slug: string }[]
    marketplace_shipments: Shipment[] | null
  }
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_STEPS = [
  { key: 'paid',       label: 'Pago confirmado', desc: 'Tu pago fue procesado exitosamente.' },
  { key: 'processing', label: 'Preparando',      desc: 'El vendedor está preparando tu pedido.' },
  { key: 'shipped',    label: 'Enviado',          desc: 'Tu pedido está en camino.' },
  { key: 'in_transit', label: 'En tránsito',      desc: 'El transportista tiene tu paquete.' },
  { key: 'delivered',  label: '¡Entregado!',      desc: 'Tu pedido fue entregado. ¡Disfrútalo!' },
]

const STATUS_META: Record<string, { badge: string; message: string }> = {
  paid:       { badge: 'bg-amber-100 text-amber-700',   message: 'El vendedor está procesando tu pedido.' },
  processing: { badge: 'bg-blue-100 text-blue-700',     message: 'El vendedor está preparando tu paquete.' },
  shipped:    { badge: 'bg-indigo-100 text-indigo-700', message: 'Tu pedido fue enviado. Ya viene en camino 🚚' },
  in_transit: { badge: 'bg-purple-100 text-purple-700', message: 'Tu paquete está en tránsito.' },
  delivered:  { badge: 'bg-green-100 text-green-700',   message: '¡Tu pedido fue entregado! Espero que te encante 🎉' },
  completed:  { badge: 'bg-gray-100 text-gray-500',     message: 'Compra completada.' },
  refunded:   { badge: 'bg-red-100 text-red-600',       message: 'Se procesó un reembolso para este pedido.' },
  fulfilled:  { badge: 'bg-green-100 text-green-700',   message: 'Tu producto digital está disponible.' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Mexico_City',
  })
}

// ── Status stepper ────────────────────────────────────────────────────────────

function StatusStepper({ status }: { status: string }) {
  const stepKeys   = STATUS_STEPS.map(s => s.key)
  const currentIdx = stepKeys.indexOf(status)

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-3.5 top-4 bottom-4 w-0.5 bg-[var(--color-border)]" />

      <div className="space-y-0">
        {STATUS_STEPS.map((step, i) => {
          const done    = i < currentIdx
          const current = i === currentIdx
          const future  = i > currentIdx
          return (
            <div key={step.key} className="relative flex items-start gap-4 pb-5 last:pb-0">
              {/* Node */}
              <div className={`relative z-10 w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold transition-colors ${
                done    ? 'bg-[var(--color-accent)] text-white' :
                current ? 'bg-[var(--color-accent)] text-white ring-4 ring-[var(--color-accent)]/20' :
                          'bg-white border-2 border-[var(--color-border)] text-[var(--color-muted)]'
              }`}>
                {done ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : current ? (
                  <div className="w-2 h-2 rounded-full bg-white" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-[var(--color-border)]" />
                )}
              </div>

              {/* Label */}
              <div className={`pt-0.5 transition-opacity ${future ? 'opacity-40' : ''}`}>
                <p className={`text-sm font-semibold ${current ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                  {step.label}
                </p>
                {current && (
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">{step.desc}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  return (
    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      <span>{type === 'success' ? '✓' : '⚠'}</span>
      <span>{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OrderTrackingClient({ order }: OrderTrackingProps) {
  const [currentStatus, setCurrentStatus] = useState(order.status)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const listing  = Array.isArray(order.marketplace_listings) ? order.marketplace_listings[0] : order.marketplace_listings
  const shop     = Array.isArray(order.marketplace_shops)    ? order.marketplace_shops[0]    : order.marketplace_shops
  const shipment = order.marketplace_shipments?.[0] ?? null
  const thumb    = listing?.images?.[0]?.url ?? null
  const meta     = STATUS_META[currentStatus] ?? STATUS_META.paid

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const trackUrl = shipment?.tracking_number
    ? carrierTrackingUrl(shipment.carrier, shipment.tracking_number)
    : null

  async function confirmDelivery() {
    setConfirming(true)
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error.', 'error'); return }
      setCurrentStatus('completed')
      showToast('¡Gracias por confirmar! Recuerda calificar al vendedor.', 'success')
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      setConfirming(false)
    }
  }

  const canConfirm = currentStatus === 'delivered'

  return (
    <div className="max-w-xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
        <Link href="/account/orders" className="hover:text-[var(--color-text)] no-underline">Mis compras</Link>
        <span>›</span>
        <span className="font-mono text-[10px]">{order.id.slice(0, 8)}…</span>
      </nav>

      {/* Status banner */}
      <div className={`flex items-center gap-3 rounded-xl px-4 py-3 mb-6 ${meta.badge}`}>
        <span className="text-base">
          {currentStatus === 'shipped' || currentStatus === 'in_transit' ? '🚚' :
           currentStatus === 'delivered' || currentStatus === 'completed' ? '✓' :
           currentStatus === 'refunded' ? '↩' : '📋'}
        </span>
        <p className="text-sm font-medium">{meta.message}</p>
      </div>

      {/* Product card */}
      <section className="border border-[var(--color-border)] rounded-xl p-4 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
            {thumb
              ? <img src={thumb} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{listing?.title}</p>
            {shop && (
              <Link href={`/s/${shop.slug}`}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] no-underline mt-0.5 block">
                {shop.name} →
              </Link>
            )}
            <p className="text-xl font-bold mt-2">{formatPrice(order.amount_cents, order.currency)}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>Comprado el {formatDate(order.created_at)}</span>
          <span className="font-mono text-[10px]">#{order.id.slice(0, 8)}</span>
        </div>
      </section>

      {/* Tracking card */}
      {shipment && (
        <section className="border border-[var(--color-border)] rounded-xl p-4 mb-5">
          <h2 className="font-semibold text-sm mb-3">Seguimiento de envío</h2>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-xl flex-shrink-0">🚚</div>
            <div>
              <p className="font-semibold text-sm">{carrierLabel(shipment.carrier)}</p>
              {shipment.tracking_number && (
                <p className="text-xs font-mono text-[var(--color-muted)]">{shipment.tracking_number}</p>
              )}
            </div>
          </div>
          {shipment.estimated_delivery_date && (
            <div className="flex items-center justify-between bg-[var(--color-surface-alt)] rounded-lg px-3 py-2 mb-3">
              <span className="text-xs text-[var(--color-muted)]">Entrega estimada</span>
              <span className="text-sm font-semibold">
                {new Date(shipment.estimated_delivery_date).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}
              </span>
            </div>
          )}
          {trackUrl && (
            <a
              href={trackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] no-underline transition-colors text-[var(--color-text)]"
            >
              📍 Rastrear en {carrierLabel(shipment.carrier)}
            </a>
          )}
        </section>
      )}

      {/* Status timeline */}
      {!['refunded', 'fulfilled'].includes(currentStatus) && (
        <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
          <h2 className="font-semibold text-sm mb-4">Estado del pedido</h2>
          <StatusStepper status={currentStatus} />
        </section>
      )}

      {/* Confirm delivery CTA */}
      {canConfirm && (
        <section className="border border-green-200 bg-green-50/50 rounded-xl p-4 mb-5">
          <p className="text-sm font-medium text-green-800 mb-1">¿Ya recibiste tu pedido?</p>
          <p className="text-xs text-green-700 mb-3">Confirmar ayuda a que el vendedor reciba su pago completo.</p>
          <button
            type="button"
            onClick={confirmDelivery}
            disabled={confirming}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? 'Confirmando…' : '✓ Sí, lo recibí — todo bien'}
          </button>
        </section>
      )}

      {/* Contact seller */}
      {shop && currentStatus !== 'completed' && currentStatus !== 'refunded' && (
        <div className="flex items-center justify-between bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-medium">¿Necesitas ayuda?</p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">Contacta al vendedor si tienes dudas sobre tu pedido.</p>
          </div>
          <Link
            href={`/s/${shop.slug}`}
            className="flex-shrink-0 text-xs font-semibold text-[var(--color-accent)] no-underline hover:underline ml-3"
          >
            Ir a la tienda →
          </Link>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}
