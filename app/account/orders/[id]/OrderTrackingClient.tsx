'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { carrierLabel, carrierTrackingUrl } from '@/lib/envia'
import AgentHandoff from '@/app/components/AgentHandoff'

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
    metadata?: Record<string, unknown> | null
    // Direct-payment ("Pago directo") fields from the Medusa order
    payment_method?: string | null
    payment_received?: boolean
    manual_payment?: {
      spei?: { clabe: string; bank_name?: string | null; account_holder?: string | null } | null
      dimo?: { phone: string } | null
      cash?: { note?: string | null } | null
    } | null
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

// Dynamic timeline per delivery method
function getStatusSteps(fulfillmentMethod: string) {
  if (fulfillmentMethod === 'local_pickup') {
    return [
      { key: 'paid',       label: 'Pago confirmado',        desc: 'Tu pago fue procesado exitosamente.' },
      { key: 'processing', label: 'Listo para recoger',     desc: 'El vendedor tiene tu artículo listo y te contactará.' },
      { key: 'delivered',  label: '¡Recogido!',             desc: '¡Listo! Recogiste tu artículo.' },
    ]
  }
  if (fulfillmentMethod === 'none' || fulfillmentMethod === 'coord') {
    return [
      { key: 'paid',       label: 'Pago confirmado',          desc: 'Tu pago fue procesado exitosamente.' },
      { key: 'processing', label: 'El vendedor te contactará', desc: 'El vendedor acordará contigo cómo y cuándo recibes tu pedido.' },
      { key: 'delivered',  label: '¡Entregado!',              desc: 'Tu pedido fue entregado. ¡Disfrútalo!' },
    ]
  }
  if (fulfillmentMethod === 'digital' || fulfillmentMethod === 'service') {
    return [
      { key: 'paid',      label: 'Pago confirmado', desc: 'Tu pago fue procesado exitosamente.' },
      { key: 'fulfilled', label: 'Disponible',      desc: 'Tu archivo o acceso digital está listo.' },
    ]
  }
  // Default: physical shipping via Envia
  return [
    { key: 'paid',       label: 'Pago confirmado', desc: 'Tu pago fue procesado exitosamente.' },
    { key: 'processing', label: 'Preparando',      desc: 'El vendedor está preparando tu paquete.' },
    { key: 'shipped',    label: 'Enviado',          desc: 'Tu pedido fue entregado a la paquetería.' },
    { key: 'in_transit', label: 'En tránsito',      desc: 'El transportista tiene tu paquete.' },
    { key: 'delivered',  label: '¡Entregado!',      desc: 'Tu pedido fue entregado. ¡Disfrútalo!' },
  ]
}

// Order-level status — badge + buyer message
const STATUS_META: Record<string, { badge: string; message: string }> = {
  // ── Standard order lifecycle ──────────────────────────────────────────────
  pending_payment:  { badge: 'bg-amber-100 text-amber-700',   message: 'Tu pago está pendiente. En cuanto el vendedor lo confirme, prepara tu pedido.' },
  paid:             { badge: 'bg-green-100 text-green-700',   message: 'El vendedor está procesando tu pedido.' },
  processing:       { badge: 'bg-blue-100 text-blue-700',     message: 'El vendedor está preparando tu paquete.' },
  shipped:          { badge: 'bg-indigo-100 text-indigo-700', message: 'Tu pedido fue enviado. Ya viene en camino 🚚' },
  in_transit:       { badge: 'bg-purple-100 text-purple-700', message: 'Tu paquete está en tránsito hacia tu domicilio.' },
  delivered:        { badge: 'bg-green-100 text-green-700',   message: '¡Tu pedido fue entregado! Espero que te encante 🎉' },
  completed:        { badge: 'bg-gray-100 text-gray-500',     message: 'Compra completada.' },
  refunded:         { badge: 'bg-red-100 text-red-600',       message: 'Se procesó un reembolso para este pedido.' },
  fulfilled:        { badge: 'bg-green-100 text-green-700',   message: 'Tu producto digital está disponible.' },
  // ── Granular shipment-level statuses (from Envia webhooks) ───────────────
  // These override the order status message when the shipment is more specific.
  label_created:    { badge: 'bg-indigo-100 text-indigo-700', message: 'La guía fue generada. El vendedor entregará tu paquete a la paquetería muy pronto.' },
  picked_up:        { badge: 'bg-purple-100 text-purple-700', message: 'La paquetería recogió tu paquete. Ya está en camino 🚚' },
  out_for_delivery: { badge: 'bg-purple-100 text-purple-700', message: '¡Tu paquete está en ruta de entrega hoy! Mantente disponible 🚚' },
  exception:        { badge: 'bg-amber-100 text-amber-700',   message: 'La paquetería reportó un inconveniente. Sigue el rastreo para más detalles o contacta al vendedor.' },
  cancelled_ship:   { badge: 'bg-amber-100 text-amber-700',   message: 'El envío fue cancelado. El vendedor está resolviendo — espera su mensaje.' },
  // ── Delivery-method–specific overrides ───────────────────────────────────
  pickup_processing: { badge: 'bg-blue-100 text-blue-700',   message: 'El vendedor tiene tu artículo listo. Te contactará para coordinar la recolección.' },
  pickup_delivered:  { badge: 'bg-green-100 text-green-700', message: '¡Recogiste tu artículo! Esperamos que te encante 🎉' },
  coord_processing:  { badge: 'bg-blue-100 text-blue-700',   message: 'El vendedor te contactará pronto para acordar cómo recibes tu pedido.' },
}

// Delivery method display label and icon
const DELIVERY_METHOD_CHIP: Record<string, { icon: string; label: string }> = {
  shipping:     { icon: '📦', label: 'Envío a domicilio' },
  local_pickup: { icon: '📍', label: 'Recolección en mano' },
  none:         { icon: '🤝', label: 'Entrega acordada' },
  coord:        { icon: '🤝', label: 'Entrega acordada' },
  digital:      { icon: '💻', label: 'Entrega digital' },
  service:      { icon: '🔧', label: 'Servicio' },
  rental:       { icon: '🔑', label: 'Renta' },
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

function StatusStepper({ status, steps }: { status: string; steps: ReturnType<typeof getStatusSteps> }) {
  const stepKeys   = steps.map(s => s.key)
  const currentIdx = stepKeys.indexOf(status)

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-3.5 top-4 bottom-4 w-0.5 bg-[var(--color-border)]" />

      <div className="space-y-0">
        {steps.map((step, i) => {
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

const RETURN_REASON_LABELS: Record<string, string> = {
  not_as_described: 'No coincide con la descripción',
  damaged:          'Artículo dañado',
  wrong_item:       'Artículo incorrecto',
  changed_mind:     'Cambié de opinión',
  other:            'Otro motivo',
}

const RETURN_STATUS_META: Record<string, { label: string; color: string }> = {
  pending:        { label: 'En revisión',        color: 'bg-amber-100 text-amber-700' },
  accepted:       { label: 'Aceptada',            color: 'bg-green-100 text-green-700' },
  partial_refund: { label: 'Reembolso parcial',   color: 'bg-blue-100 text-blue-700' },
  declined:       { label: 'Rechazada',           color: 'bg-red-100 text-red-600' },
  refunded:       { label: 'Reembolsado',         color: 'bg-green-100 text-green-700' },
}

export default function OrderTrackingClient({ order }: OrderTrackingProps) {
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const isEscrowOrder = !!meta.escrow_mode
  const escrowCaptured = !!meta.escrow_captured
  const isSpeiOrder = ['manual', 'spei', 'cash', 'dimo'].includes(meta.payment_method as string)
  const paymentReceived = !!meta.payment_received

  const [currentStatus, setCurrentStatus] = useState(order.status)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [escrowConfirmed, setEscrowConfirmed] = useState(escrowCaptured)

  // Return request state
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnReason, setReturnReason] = useState('not_as_described')
  const [returnDesc, setReturnDesc] = useState('')
  const [submittingReturn, setSubmittingReturn] = useState(false)
  const [returnRequest, setReturnRequest] = useState<{ id: string; status: string; reason: string; description?: string | null; seller_note?: string | null } | null>(null)

  const listing  = Array.isArray(order.marketplace_listings) ? order.marketplace_listings[0] : order.marketplace_listings
  const shop     = Array.isArray(order.marketplace_shops)    ? order.marketplace_shops[0]    : order.marketplace_shops
  const shipment = order.marketplace_shipments?.[0] ?? null
  const thumb    = listing?.images?.[0]?.url ?? null

  // Delivery method from metadata (preferred) or legacy shipping_method field
  const fulfillmentMethod = (meta.fulfillment_method as string | undefined) ?? order.shipping_method ?? 'shipping'
  const statusSteps = getStatusSteps(fulfillmentMethod)
  const deliveryChip = DELIVERY_METHOD_CHIP[fulfillmentMethod] ?? DELIVERY_METHOD_CHIP.shipping

  // Effective status key — shipment.status can be more granular than order.status
  const effectiveStatusKey = (() => {
    if (!shipment) return currentStatus
    const ss = shipment.status
    if (ss === 'out_for_delivery') return 'out_for_delivery'
    if (ss === 'picked_up')        return 'picked_up'
    if (ss === 'label_created' && currentStatus === 'shipped') return 'label_created'
    if (ss === 'exception')        return 'exception'
    if (ss === 'cancelled')        return 'cancelled_ship'
    // Delivery-method-specific context overrides
    if (fulfillmentMethod === 'local_pickup' && currentStatus === 'processing') return 'pickup_processing'
    if (fulfillmentMethod === 'local_pickup' && currentStatus === 'delivered')  return 'pickup_delivered'
    if ((fulfillmentMethod === 'none' || fulfillmentMethod === 'coord') && currentStatus === 'processing') return 'coord_processing'
    return currentStatus
  })()
  const statusMeta = STATUS_META[effectiveStatusKey] ?? STATUS_META[currentStatus] ?? STATUS_META.paid

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
      // Escrow orders: use the dedicated confirm-delivery endpoint that triggers capture
      const endpoint = isEscrowOrder
        ? `/api/orders/${order.id}/confirm-delivery`
        : `/api/orders/${order.id}`
      const method = isEscrowOrder ? 'POST' : 'PATCH'
      const body = isEscrowOrder ? '{}' : JSON.stringify({ status: 'completed' })

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const data = await res.json() as { status?: string; confirmed?: boolean; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error.', 'error'); return }
      setCurrentStatus('completed')
      if (isEscrowOrder) {
        setEscrowConfirmed(true)
        showToast('Pago liberado al vendedor. ¡Gracias!', 'success')
      } else {
        showToast('¡Gracias por confirmar! Recuerda calificar al vendedor.', 'success')
      }
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      setConfirming(false)
    }
  }

  // For escrow: can confirm when delivered and not yet captured
  // For regular: can confirm when delivered
  const canConfirm = currentStatus === 'delivered' && (!isEscrowOrder || !escrowConfirmed)

  async function loadReturnRequest() {
    try {
      const res = await fetch(`/api/orders/${order.id}/return-request`)
      const data = await res.json() as { requests?: Array<{ id: string; status: string; reason: string; description?: string | null; seller_note?: string | null }> }
      if (res.ok && data.requests?.length) setReturnRequest(data.requests[0])
    } catch { /* silent */ }
  }

  // Load existing return on mount if order is delivered/completed
  useState(() => {
    if (['delivered', 'completed', 'refunded'].includes(order.status)) loadReturnRequest()
  })

  async function submitReturn() {
    setSubmittingReturn(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/return-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: returnReason, description: returnDesc.trim() || undefined }),
      })
      const data = await res.json() as { requestId?: string; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al enviar.', 'error'); return }
      setReturnRequest({ id: data.requestId!, status: 'pending', reason: returnReason, description: returnDesc.trim() || null })
      setShowReturnForm(false)
      showToast('Solicitud enviada. El vendedor responderá en 3 días hábiles.', 'success')
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      setSubmittingReturn(false)
    }
  }

  const canRequestReturn = ['delivered', 'completed'].includes(currentStatus) && !returnRequest

  return (
    <div className="max-w-xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
        <Link href="/account/orders" className="hover:text-[var(--color-text)] no-underline">Mis compras</Link>
        <span>›</span>
        <span className="font-mono text-[10px]">{order.id.slice(0, 8)}…</span>
      </nav>

      {/* Status banner */}
      <div className={`rounded-xl px-4 py-3 mb-6 ${statusMeta.badge}`}>
        <div className="flex items-start gap-3">
          <span className="text-base mt-0.5 flex-shrink-0">
            {effectiveStatusKey === 'out_for_delivery' || currentStatus === 'shipped' || currentStatus === 'in_transit' || effectiveStatusKey === 'picked_up' ? '🚚' :
             currentStatus === 'delivered' || currentStatus === 'completed' ? '✓' :
             currentStatus === 'refunded' ? '↩' :
             effectiveStatusKey === 'exception' || effectiveStatusKey === 'cancelled_ship' ? '⚠️' : '📋'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{statusMeta.message}</p>
            {/* Delivery method chip */}
            <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium opacity-75">
              {deliveryChip.icon} {deliveryChip.label}
            </span>
          </div>
        </div>
      </div>

      {/* Pago directo — pending payment instructions (all configured methods) */}
      {order.payment_method === 'manual' && !order.payment_received && order.manual_payment && (
        <section className="border-2 border-green-300 bg-green-50 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">✅</span>
            <h2 className="text-sm font-bold text-green-900">Pedido reservado — completa tu pago</h2>
          </div>
          <p className="text-xs text-green-800 mb-3">
            Paga <strong>{formatPrice(order.amount_cents, order.currency)}</strong> con cualquiera de estas opciones. El vendedor confirmará tu pago y procesará el pedido. Puedes pagar como prefieras.
          </p>
          <div className="space-y-2">
            {order.manual_payment.spei?.clabe && (
              <div className="bg-white border border-green-200 rounded-lg p-3">
                <p className="text-[10px] uppercase font-semibold text-gray-500">Transferencia SPEI</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="font-mono text-base font-bold tracking-wide">{order.manual_payment.spei.clabe}</p>
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(order.manual_payment!.spei!.clabe); showToast('CLABE copiada', 'success') }}
                    className="text-xs font-semibold text-green-700 hover:underline flex-shrink-0">Copiar</button>
                </div>
                {order.manual_payment.spei.bank_name && <p className="text-xs text-gray-600">Banco: <strong>{order.manual_payment.spei.bank_name}</strong></p>}
                {order.manual_payment.spei.account_holder && <p className="text-xs text-gray-600">Titular: <strong>{order.manual_payment.spei.account_holder}</strong></p>}
              </div>
            )}
            {order.manual_payment.dimo?.phone && (
              <div className="bg-white border border-green-200 rounded-lg p-3">
                <p className="text-[10px] uppercase font-semibold text-gray-500">DiMo — transfiere a este teléfono</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="font-mono text-base font-bold tracking-wide">{order.manual_payment.dimo.phone}</p>
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(order.manual_payment!.dimo!.phone); showToast('Teléfono copiado', 'success') }}
                    className="text-xs font-semibold text-green-700 hover:underline flex-shrink-0">Copiar</button>
                </div>
              </div>
            )}
            {order.manual_payment.cash && (
              <div className="bg-white border border-green-200 rounded-lg p-3">
                <p className="text-[10px] uppercase font-semibold text-gray-500">Efectivo al recoger</p>
                <p className="text-xs text-gray-700 mt-1">{order.manual_payment.cash.note || 'Paga en efectivo cuando recojas tu pedido.'}</p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-green-700 mt-3">Te enviamos estos datos por correo. El vendedor confirmará en cuanto reciba el pago.</p>
        </section>
      )}

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

      {/* Tracking card — only shown for shipping method orders with a real shipment */}
      {shipment && shipment.tracking_number && (
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
          <StatusStepper status={currentStatus} steps={statusSteps} />
        </section>
      )}

      {/* SPEI/cash pending payment notice */}
      {isSpeiOrder && !paymentReceived && (
        <section className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-700">🏦</span>
            <p className="text-sm font-semibold text-amber-800">Pago pendiente de verificación</p>
          </div>
          <p className="text-xs text-amber-700 mb-3">
            Tu pago directo está en proceso. El vendedor confirmará cuando reciba el depósito. Si ya transferiste, avísale para agilizar.
          </p>
          <ReportPaymentButton orderId={order.id} />
        </section>
      )}
      {isSpeiOrder && paymentReceived && (
        <section className="border border-green-200 bg-green-50/50 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <p className="text-sm font-semibold text-green-800">Pago confirmado por el vendedor</p>
          </div>
        </section>
      )}

      {/* Confirm delivery CTA */}
      {canConfirm && (
        <section className="border border-green-200 bg-green-50/50 rounded-xl p-4 mb-5">
          {isEscrowOrder ? (
            <>
              <p className="text-sm font-medium text-green-800 mb-1">¿Ya recibiste tu pedido en buen estado?</p>
              <p className="text-xs text-green-700 mb-3">
                Al confirmar, el pago en custodia se libera al vendedor. Si hay un problema, solicita devolución antes de confirmar.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-green-800 mb-1">¿Ya recibiste tu pedido?</p>
              <p className="text-xs text-green-700 mb-3">Confirmar ayuda a que el vendedor reciba su pago completo.</p>
            </>
          )}
          <button
            type="button"
            onClick={confirmDelivery}
            disabled={confirming}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? 'Confirmando…' : isEscrowOrder ? '✓ Sí, lo recibí — liberar pago' : '✓ Sí, lo recibí — todo bien'}
          </button>
        </section>
      )}

      {/* Escrow captured confirmation */}
      {isEscrowOrder && escrowConfirmed && currentStatus !== 'delivered' && (
        <section className="border border-green-200 bg-green-50/50 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <p className="text-sm font-semibold text-green-800">Pago liberado al vendedor</p>
          </div>
          <p className="text-xs text-green-700 mt-1">El vendedor ya recibió el pago. ¡Gracias por tu compra!</p>
        </section>
      )}

      {/* Return request — existing */}
      {returnRequest && (
        <section className={`border rounded-xl p-4 mb-5 ${RETURN_STATUS_META[returnRequest.status]?.color.includes('green') ? 'border-green-200 bg-green-50/50' : returnRequest.status === 'declined' ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Solicitud de devolución</h2>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${RETURN_STATUS_META[returnRequest.status]?.color}`}>
              {RETURN_STATUS_META[returnRequest.status]?.label ?? returnRequest.status}
            </span>
          </div>
          <p className="text-xs text-[var(--color-muted)] mb-1">
            <strong>Motivo:</strong> {RETURN_REASON_LABELS[returnRequest.reason] ?? returnRequest.reason}
          </p>
          {returnRequest.description && (
            <p className="text-xs text-[var(--color-muted)] mb-1 italic">&ldquo;{returnRequest.description}&rdquo;</p>
          )}
          {returnRequest.seller_note && (
            <div className="mt-2 pt-2 border-t border-current/20">
              <p className="text-xs font-medium mb-0.5">Respuesta del vendedor:</p>
              <p className="text-xs text-[var(--color-muted)] italic">&ldquo;{returnRequest.seller_note}&rdquo;</p>
            </div>
          )}
          {returnRequest.status === 'pending' && (
            <p className="text-xs text-[var(--color-muted)] mt-2">El vendedor tiene 3 días hábiles para responder.</p>
          )}
        </section>
      )}

      {/* Return request — open form */}
      {canRequestReturn && !showReturnForm && (
        <button
          type="button"
          onClick={() => setShowReturnForm(true)}
          className="w-full text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-left flex items-center gap-2 mb-5 transition-colors hover:bg-[var(--color-surface-alt)]"
        >
          <span>↩</span>
          <span>¿Hay un problema con tu pedido? Solicitar devolución</span>
        </button>
      )}

      {canRequestReturn && showReturnForm && (
        <section className="border border-[var(--color-border)] rounded-xl p-4 mb-5">
          <h2 className="font-semibold text-sm mb-3">Solicitar devolución</h2>
          <div className="mb-3">
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1.5">¿Cuál es el motivo?</label>
            <div className="space-y-1.5">
              {Object.entries(RETURN_REASON_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="returnReason"
                    value={key}
                    checked={returnReason === key}
                    onChange={() => setReturnReason(key)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1.5">
              Descripción <span className="font-normal">(opcional)</span>
            </label>
            <textarea
              value={returnDesc}
              onChange={e => setReturnDesc(e.target.value)}
              rows={2}
              placeholder="Describe el problema con más detalle…"
              className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
            />
          </div>

          {/* AI agent handoff — let an agent open and follow up on the refund */}
          <div className="mb-4">
            <AgentHandoff
              title="¿Prefieres que un agente lo haga por ti?"
              subtitle="Un agente IA puede abrir tu devolución, dar seguimiento al vendedor y gestionar el reembolso. Copia el prompt y ábrelo en Claude."
              prompt={`Ayúdame a iniciar y dar seguimiento a una devolución/reembolso en Miyagi Sánchez para mi pedido ${order.id}${listing?.title ? ` ("${listing.title}")` : ''}.\n\nPrimero lee la ficha del marketplace en https://miyagisanchez.com/agent y conéctate al servidor MCP. Luego propón un plan (motivo de la devolución, evidencia y monto a reembolsar) y ejecútalo por mí.\n\nMi pedido: https://miyagisanchez.com/account/orders/${order.id}`}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitReturn}
              disabled={submittingReturn}
              className="flex-1 bg-[var(--color-accent)] text-white py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {submittingReturn ? 'Enviando…' : 'Enviar solicitud'}
            </button>
            <button
              type="button"
              onClick={() => setShowReturnForm(false)}
              className="px-4 py-2.5 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-alt)] transition-colors"
            >
              Cancelar
            </button>
          </div>
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

// Buyer nudge for manual (SPEI/cash/DiMo) orders: notify the seller they've paid.
function ReportPaymentButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  async function report() {
    setState('sending')
    try {
      const res = await fetch(`/api/orders/${orderId}/report-payment`, { method: 'POST' })
      setState(res.ok ? 'done' : 'idle')
    } catch { setState('idle') }
  }
  return (
    <button
      type="button"
      onClick={report}
      disabled={state !== 'idle'}
      className="text-xs font-semibold bg-amber-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-60"
    >
      {state === 'done' ? '✓ Avisaste al vendedor' : state === 'sending' ? 'Avisando…' : 'Ya hice el pago'}
    </button>
  )
}
