'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { carrierLabel, carrierTrackingUrl, CARRIER_LABELS } from '@/lib/envia'
import AgentHandoff from '@/app/components/AgentHandoff'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shipment {
  id: string
  carrier: string
  tracking_number: string | null
  label_url: string | null
  status: string
  estimated_delivery_date: string | null
  weight_grams: number | null
  envia_shipment_id: string | null
  created_at: string
}

interface EnviaRate {
  rateId: string
  carrier: string
  service: string
  totalPrice: number
  currency: string
  deliveryEstimate: number | null
}

interface OrderDetailProps {
  order: {
    id: string
    status: string
    amount_cents: number
    currency: string
    shipping_method: string
    shipping_cost_cents: number
    shipping_address: Record<string, string> | null
    buyer_name: string | null
    buyer_email: string | null
    created_at: string
    updated_at: string
    metadata?: Record<string, unknown> | null
    marketplace_listings:
      | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string; metadata: unknown }
      | { id: string; title: string; images: Array<{ url: string }> | null; listing_type: string; metadata: unknown }[]
    marketplace_shops:
      | { id: string; name: string; slug: string; clerk_user_id: string | null; metadata: Record<string, unknown> | null }
      | { id: string; name: string; slug: string; clerk_user_id: string | null; metadata: Record<string, unknown> | null }[]
    marketplace_shipments: Shipment[] | null
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ORDER_STEPS = [
  { key: 'paid',       label: 'Pagado' },
  { key: 'processing', label: 'Preparando' },
  { key: 'shipped',    label: 'Enviado' },
  { key: 'in_transit', label: 'En camino' },
  { key: 'delivered',  label: 'Entregado' },
]

const STATUS_META: Record<string, { label: string; badge: string }> = {
  pending_payment: { label: 'Pago pendiente', badge: 'bg-amber-100 text-amber-700' },
  paid:       { label: 'Nuevo',      badge: 'bg-green-100 text-green-700' },
  processing: { label: 'Procesando', badge: 'bg-blue-100 text-blue-700' },
  shipped:    { label: 'Enviado',    badge: 'bg-indigo-100 text-indigo-700' },
  in_transit: { label: 'En camino',  badge: 'bg-purple-100 text-purple-700' },
  delivered:  { label: 'Entregado',  badge: 'bg-green-100 text-green-700' },
  completed:  { label: 'Completado', badge: 'bg-gray-100 text-gray-500' },
  refunded:   { label: 'Reembolso',  badge: 'bg-red-100 text-red-600' },
  fulfilled:  { label: 'Entregado',  badge: 'bg-green-100 text-green-700' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Mexico_City',
  })
}

function formatAddress(addr: Record<string, string> | null): string {
  if (!addr) return '—'
  const parts = [
    addr.line1 ?? addr.street,
    addr.line2 ?? addr.colonia,
    addr.city,
    addr.state,
    addr.postal_code ?? addr.postalCode,
    addr.country,
  ].filter(Boolean)
  return parts.join(', ')
}

// ── Status stepper ────────────────────────────────────────────────────────────

function StatusStepper({ status }: { status: string }) {
  const stepKeys = ORDER_STEPS.map(s => s.key)
  const currentIdx = stepKeys.indexOf(status)

  return (
    <div className="flex items-center gap-0 w-full">
      {ORDER_STEPS.map((step, i) => {
        const done    = i < currentIdx
        const current = i === currentIdx
        const future  = i > currentIdx
        return (
          <div key={step.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done    ? 'bg-[var(--color-accent)] text-white' :
                current ? 'bg-[var(--color-accent)] text-white ring-4 ring-[var(--color-accent)]/20' :
                          'bg-[var(--color-border)] text-[var(--color-muted)]'
              }`}>
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`mt-1 text-[10px] font-medium text-center leading-tight ${
                current ? 'text-[var(--color-accent)]' :
                done    ? 'text-[var(--color-text)]' :
                          'text-[var(--color-muted)]'
              }`}>
                {step.label}
              </span>
            </div>
            {i < ORDER_STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${
                i < currentIdx ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
              }`} />
            )}
          </div>
        )
      })}
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

// ── Shipping section ──────────────────────────────────────────────────────────

function ShippingSection({
  orderId,
  shippingAddress,
  existingShipment,
  onShipped,
}: {
  orderId: string
  shippingAddress: Record<string, string> | null
  existingShipment: Shipment | null
  onShipped: (shipment: Partial<Shipment>) => void
}) {
  const [mode, setMode] = useState<'choose' | 'envia' | 'manual'>('choose')

  // Envia state
  const [weightGrams, setWeightGrams] = useState('500')
  const [lengthCm, setLengthCm]       = useState('20')
  const [widthCm, setWidthCm]         = useState('15')
  const [heightCm, setHeightCm]       = useState('10')
  const [rates, setRates]             = useState<EnviaRate[] | null>(null)
  const [selectedRate, setSelectedRate] = useState<EnviaRate | null>(null)
  const [quotingRates, setQuotingRates] = useState(false)
  const [quoteError, setQuoteError]   = useState<string | null>(null)
  const [creatingLabel, setCreatingLabel] = useState(false)
  const [labelError, setLabelError]   = useState<string | null>(null)

  // Manual state
  const [manualCarrier, setManualCarrier] = useState('dhl')
  const [manualTracking, setManualTracking] = useState('')
  const [manualCarrierLabel, setManualCarrierLabel] = useState('')
  const [sendingManual, setSendingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  const hasAddress = !!(shippingAddress?.postal_code || shippingAddress?.postalCode)

  async function getQuote() {
    setQuotingRates(true); setQuoteError(null); setRates(null)
    try {
      const params = new URLSearchParams({
        weightGrams, lengthCm, widthCm, heightCm,
      })
      const res = await fetch(`/api/orders/${orderId}/ship?${params}`)
      const data = await res.json() as { rates?: EnviaRate[]; error?: string; code?: string }
      if (!res.ok) {
        setQuoteError(data.error ?? 'Error al cotizar.')
        if (data.code === 'MISSING_ORIGIN_ADDRESS') {
          setQuoteError('Configura tu dirección de origen en Ajustes de tienda antes de continuar.')
        }
        return
      }
      setRates(data.rates ?? [])
      if (!data.rates?.length) setQuoteError('No hay tarifas disponibles para esta ruta. Intenta con envío manual.')
    } catch {
      setQuoteError('Sin conexión. Verifica tu internet.')
    } finally {
      setQuotingRates(false)
    }
  }

  async function createLabel() {
    if (!selectedRate) return
    setCreatingLabel(true); setLabelError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rateId: selectedRate.rateId,
          weightGrams: parseInt(weightGrams),
          dimensions: { lengthCm: parseInt(lengthCm), widthCm: parseInt(widthCm), heightCm: parseInt(heightCm) },
        }),
      })
      const data = await res.json() as { trackingNumber?: string; labelUrl?: string; carrier?: string; estimatedDeliveryDate?: string; error?: string }
      if (!res.ok) { setLabelError(data.error ?? 'Error al generar la etiqueta.'); return }
      onShipped({
        carrier: data.carrier ?? selectedRate.carrier,
        tracking_number: data.trackingNumber ?? null,
        label_url: data.labelUrl ?? null,
        estimated_delivery_date: data.estimatedDeliveryDate ?? null,
        status: 'label_created',
      })
    } catch {
      setLabelError('Sin conexión. Verifica tu internet.')
    } finally {
      setCreatingLabel(false)
    }
  }

  async function sendManual() {
    setSendingManual(true); setManualError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/ship-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: manualCarrier,
          trackingNumber: manualTracking.trim() || undefined,
          carrierLabel: manualCarrier === 'otro' ? manualCarrierLabel : undefined,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setManualError(data.error ?? 'Error al registrar envío.'); return }
      onShipped({
        carrier: manualCarrier,
        tracking_number: manualTracking.trim() || null,
        label_url: null,
        status: 'label_created',
      })
    } catch {
      setManualError('Sin conexión. Verifica tu internet.')
    } finally {
      setSendingManual(false)
    }
  }

  // Already shipped
  if (existingShipment) {
    const trackUrl = existingShipment.tracking_number
      ? carrierTrackingUrl(existingShipment.carrier, existingShipment.tracking_number)
      : null

    return (
      <section className="border border-[var(--color-border)] rounded-xl p-5">
        <h2 className="font-semibold text-sm text-[var(--color-muted)] uppercase tracking-wide mb-3">Envío</h2>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-lg">🚚</div>
          <div className="flex-1">
            <p className="font-semibold text-sm">{carrierLabel(existingShipment.carrier)}</p>
            {existingShipment.tracking_number && (
              <p className="text-xs text-[var(--color-muted)] mt-0.5 font-mono">{existingShipment.tracking_number}</p>
            )}
            {existingShipment.estimated_delivery_date && (
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                Entrega estimada: {new Date(existingShipment.estimated_delivery_date).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}
              </p>
            )}
            <div className="flex gap-2 mt-2.5 flex-wrap">
              {existingShipment.label_url && (
                <a href={existingShipment.label_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white no-underline hover:bg-[var(--color-accent-hover)]">
                  🖨 Imprimir guía
                </a>
              )}
              {trackUrl && (
                <a href={trackUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-alt)]">
                  📍 Rastrear paquete
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="border border-[var(--color-border)] rounded-xl overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <h2 className="font-semibold text-sm text-[var(--color-muted)] uppercase tracking-wide">Enviar pedido</h2>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          El comprador recibirá un correo con los datos de seguimiento cuando confirmes el envío.
        </p>
      </div>

      <div className="p-5">
        {/* Address missing warning */}
        {!hasAddress && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4">
            <span className="text-amber-500 text-sm mt-0.5">⚠</span>
            <p className="text-xs text-amber-800">
              Este pedido no tiene dirección de envío registrada. Coordina la entrega directamente con el comprador.
            </p>
          </div>
        )}

        {/* Mode chooser */}
        {mode === 'choose' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('envia')}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 transition-all text-center"
            >
              <span className="text-2xl">📦</span>
              <div>
                <p className="font-semibold text-sm">Envia.com</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">Cotiza y genera guía con DHL, FedEx, Estafeta…</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 transition-all text-center"
            >
              <span className="text-2xl">✏️</span>
              <div>
                <p className="font-semibold text-sm">Envío manual</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">Ingresa tu guía propia o de mensajería local</p>
              </div>
            </button>
          </div>
        )}

        {/* Envia flow */}
        {mode === 'envia' && !rates && (
          <div>
            <button type="button" onClick={() => setMode('choose')}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] mb-4 flex items-center gap-1">
              ← Volver
            </button>
            <h3 className="font-semibold text-sm mb-3">Datos del paquete</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Peso (gramos)</label>
                <input type="number" value={weightGrams} onChange={e => setWeightGrams(e.target.value)} min="1"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Largo (cm)</label>
                <input type="number" value={lengthCm} onChange={e => setLengthCm(e.target.value)} min="1"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Ancho (cm)</label>
                <input type="number" value={widthCm} onChange={e => setWidthCm(e.target.value)} min="1"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Alto (cm)</label>
                <input type="number" value={heightCm} onChange={e => setHeightCm(e.target.value)} min="1"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
              </div>
            </div>
            {quoteError && <p className="text-red-600 text-xs mb-3">⚠ {quoteError}</p>}
            <button type="button" onClick={getQuote} disabled={quotingRates}
              className="w-full bg-[var(--color-accent)] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors">
              {quotingRates ? 'Cotizando…' : 'Ver tarifas disponibles →'}
            </button>
          </div>
        )}

        {/* Rate picker */}
        {mode === 'envia' && rates && (
          <div>
            <button type="button" onClick={() => { setRates(null); setSelectedRate(null) }}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] mb-4 flex items-center gap-1">
              ← Cambiar medidas
            </button>
            <h3 className="font-semibold text-sm mb-3">Elige un servicio</h3>
            <div className="space-y-2 mb-4">
              {rates.map(rate => (
                <button
                  key={rate.rateId}
                  type="button"
                  onClick={() => setSelectedRate(rate)}
                  className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
                    selectedRate?.rateId === rate.rateId
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                      : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/50'
                  }`}
                >
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{carrierLabel(rate.carrier)} <span className="font-normal text-[var(--color-muted)]">· {rate.service}</span></p>
                    {rate.deliveryEstimate && (
                      <p className="text-xs text-[var(--color-muted)] mt-0.5">{rate.deliveryEstimate} día{rate.deliveryEstimate > 1 ? 's' : ''} hábil{rate.deliveryEstimate > 1 ? 'es' : ''}</p>
                    )}
                  </div>
                  <span className="font-bold text-sm text-[var(--color-accent)]">
                    {new Intl.NumberFormat('es-MX', { style: 'currency', currency: rate.currency, maximumFractionDigits: 0 }).format(rate.totalPrice)}
                  </span>
                </button>
              ))}
            </div>
            {labelError && <p className="text-red-600 text-xs mb-3">⚠ {labelError}</p>}
            <button type="button" onClick={createLabel} disabled={!selectedRate || creatingLabel}
              className="w-full bg-[var(--color-accent)] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors">
              {creatingLabel ? 'Generando guía…' : '📦 Generar guía y confirmar envío'}
            </button>
          </div>
        )}

        {/* Manual flow */}
        {mode === 'manual' && (
          <div>
            <button type="button" onClick={() => setMode('choose')}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] mb-4 flex items-center gap-1">
              ← Volver
            </button>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Paquetería</label>
                <select value={manualCarrier} onChange={e => setManualCarrier(e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-white">
                  {Object.entries(CARRIER_LABELS).filter(([k]) => k !== 'manual').map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                  <option value="otro">Otra / Mensajero local</option>
                </select>
              </div>
              {manualCarrier === 'otro' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Nombre de la paquetería</label>
                  <input type="text" value={manualCarrierLabel} onChange={e => setManualCarrierLabel(e.target.value)}
                    placeholder="Ej: Mensajero propio"
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
                  Número de guía <span className="font-normal">(opcional)</span>
                </label>
                <input type="text" value={manualTracking} onChange={e => setManualTracking(e.target.value)}
                  placeholder="Ej: 123456789012"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
              </div>
            </div>
            {manualError && <p className="text-red-600 text-xs mb-3">⚠ {manualError}</p>}
            <button type="button" onClick={sendManual} disabled={sendingManual}
              className="w-full bg-[var(--color-accent)] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors">
              {sendingManual ? 'Guardando…' : '✓ Confirmar envío'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const RETURN_REASON_LABELS: Record<string, string> = {
  not_as_described: 'No coincide con la descripción',
  damaged:          'Artículo dañado',
  wrong_item:       'Artículo incorrecto',
  changed_mind:     'Cambié de opinión',
  other:            'Otro motivo',
}

const RETURN_STATUS_META: Record<string, { label: string; badge: string }> = {
  pending:        { label: 'Pendiente',         badge: 'bg-amber-100 text-amber-700' },
  accepted:       { label: 'Aceptada',           badge: 'bg-green-100 text-green-700' },
  partial_refund: { label: 'Reembolso parcial',  badge: 'bg-blue-100 text-blue-700' },
  declined:       { label: 'Rechazada',          badge: 'bg-red-100 text-red-600' },
  refunded:       { label: 'Reembolsado',        badge: 'bg-green-100 text-green-700' },
}

export default function OrderDetail({ order }: OrderDetailProps) {
  const orderMeta = (order.metadata ?? {}) as Record<string, unknown>
  const isEscrowOrder = !!orderMeta.escrow_mode
  const escrowCapturedInit = !!orderMeta.escrow_captured
  const isSpeiOrder = ['manual', 'spei', 'cash', 'dimo'].includes(orderMeta.payment_method as string)
  const paymentReceivedInit = !!orderMeta.payment_received
  const fulfillmentMethod = (orderMeta.fulfillment_method as string | undefined) ?? order.shipping_method ?? 'shipping'
  const isPickupOrder = fulfillmentMethod === 'local_pickup'
  const isCoordOrder  = fulfillmentMethod === 'none' || fulfillmentMethod === 'coord' || fulfillmentMethod === 'rental'

  const [currentStatus, setCurrentStatus] = useState(order.status)
  const [currentShipment, setCurrentShipment] = useState<Shipment | null>(
    order.marketplace_shipments?.[0] ?? null,
  )
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [escrowCaptured, setEscrowCaptured] = useState(escrowCapturedInit)
  const [paymentReceived, setPaymentReceived] = useState(paymentReceivedInit)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [releasingEscrow, setReleasingEscrow] = useState(false)

  // Return request state
  const [returnRequest, setReturnRequest] = useState<{
    id: string; status: string; reason: string; description: string | null; seller_note: string | null; refund_amount_cents: number | null
  } | null>(null)
  const [returnLoaded, setReturnLoaded] = useState(false)
  const [showReturnPanel, setShowReturnPanel] = useState(false)
  const [returnSellerNote, setReturnSellerNote] = useState('')
  const [partialRefundCents, setPartialRefundCents] = useState('')
  const [processingReturn, setProcessingReturn] = useState(false)

  // Seller-initiated refund state
  const [showInitiateRefund, setShowInitiateRefund] = useState(false)
  const [initiateAmount, setInitiateAmount] = useState('')
  const [initiateNote, setInitiateNote] = useState('')
  const [initiatingRefund, setInitiatingRefund] = useState(false)
  const [refundIssued, setRefundIssued] = useState(false)

  const listing = Array.isArray(order.marketplace_listings)
    ? order.marketplace_listings[0]
    : order.marketplace_listings
  const shop = Array.isArray(order.marketplace_shops)
    ? order.marketplace_shops[0]
    : order.marketplace_shops

  const thumb  = listing?.images?.[0]?.url ?? null
  const meta   = STATUS_META[currentStatus] ?? STATUS_META.paid

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  async function updateStatus(newStatus: string) {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al actualizar.', 'error'); return }
      setCurrentStatus(data.status ?? newStatus)
      showToast('Estado actualizado.', 'success')
    } catch {
      showToast('Sin conexión.', 'error')
    } finally {
      setUpdatingStatus(false)
    }
  }

  function handleShipped(shipment: Partial<Shipment>) {
    setCurrentShipment(shipment as Shipment)
    setCurrentStatus('shipped')
    showToast('¡Envío confirmado! El comprador recibió una notificación.', 'success')
  }

  async function loadReturnRequest() {
    if (returnLoaded) return
    setReturnLoaded(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/return-request`)
      const data = await res.json() as { requests?: Array<{ id: string; status: string; reason: string; description: string | null; seller_note: string | null; refund_amount_cents: number | null }> }
      if (res.ok && data.requests?.length) {
        setReturnRequest(data.requests[0])
        setShowReturnPanel(true)
      }
    } catch { /* silent */ }
  }

  async function handleReturnAction(action: 'accept' | 'partial_refund' | 'decline') {
    if (!returnRequest) return
    setProcessingReturn(true)
    try {
      const refundCents = action === 'partial_refund'
        ? Math.round(parseFloat(partialRefundCents.replace(/[^0-9.]/g, '')) * 100)
        : undefined
      const res = await fetch(`/api/orders/${order.id}/return-request/${returnRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, seller_note: returnSellerNote.trim() || undefined, refund_amount_cents: refundCents }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al procesar.', 'error'); return }
      setReturnRequest(r => r ? { ...r, status: data.status ?? action, seller_note: returnSellerNote.trim() || null } : null)
      if (data.status === 'refunded' || action === 'accept') setCurrentStatus('refunded')
      showToast(
        action === 'decline' ? 'Solicitud rechazada.' : 'Reembolso procesado. El comprador fue notificado.',
        'success',
      )
    } catch {
      showToast('Sin conexión.', 'error')
    } finally {
      setProcessingReturn(false)
    }
  }

  async function handleInitiateRefund() {
    setInitiatingRefund(true)
    try {
      const amountCents = initiateAmount.trim()
        ? Math.round(parseFloat(initiateAmount.replace(/[^0-9.]/g, '')) * 100)
        : undefined
      if (amountCents != null && (!amountCents || amountCents <= 0)) {
        showToast('Ingresa un monto válido.', 'error')
        setInitiatingRefund(false)
        return
      }
      // requestId is unused for seller_refund — the backend synthesizes the record.
      const res = await fetch(`/api/orders/${order.id}/return-request/new`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'seller_refund',
          refund_amount_cents: amountCents,
          seller_note: initiateNote.trim() || undefined,
        }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al emitir el reembolso.', 'error'); return }
      setRefundIssued(true)
      setShowInitiateRefund(false)
      setCurrentStatus('refunded')
      showToast('Reembolso emitido. El comprador fue notificado.', 'success')
    } catch {
      showToast('Sin conexión.', 'error')
    } finally {
      setInitiatingRefund(false)
    }
  }

  async function handleConfirmPayment() {
    setConfirmingPayment(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/confirm-payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json() as { confirmed?: boolean; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al confirmar.', 'error'); return }
      setPaymentReceived(true)
      showToast('Pago confirmado. El pedido sigue su flujo normal.', 'success')
    } catch {
      showToast('Sin conexión.', 'error')
    } finally {
      setConfirmingPayment(false)
    }
  }

  async function handleReleaseEscrow() {
    setReleasingEscrow(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/release-escrow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json() as { released?: boolean; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al liberar.', 'error'); return }
      setEscrowCaptured(true)
      showToast('Pago liberado exitosamente.', 'success')
    } catch {
      showToast('Sin conexión.', 'error')
    } finally {
      setReleasingEscrow(false)
    }
  }

  const canShip = ['paid', 'processing'].includes(currentStatus) && listing?.listing_type === 'product'

  // Seller can initiate a refund once payment is in (card paid; SPEI/cash confirmed),
  // the order isn't already refunded, and there's no active buyer return request to
  // resolve instead (a pending/accepted one uses the existing accept/decline panel).
  const hasActiveBuyerRequest = !!returnRequest && !['declined', 'refunded'].includes(returnRequest.status)
  const paymentSettled = !isSpeiOrder || paymentReceived
  const canInitiateRefund =
    paymentSettled &&
    !refundIssued &&
    currentStatus !== 'refunded' &&
    !hasActiveBuyerRequest

  const orderTotalPesos = (order.amount_cents / 100).toFixed(0)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
        <Link href="/shop/manage" className="hover:text-[var(--color-text)] no-underline">Mi tienda</Link>
        <span>›</span>
        <Link href="/shop/manage/orders" className="hover:text-[var(--color-text)] no-underline">Pedidos</Link>
        <span>›</span>
        <span className="font-mono text-[10px]">{order.id.slice(0, 8)}…</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold">Pedido</h1>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
          </div>
          <p className="text-xs text-[var(--color-muted)] font-mono">{order.id}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{formatDate(order.created_at)}</p>
        </div>
        <Link href="/shop/manage/orders"
          className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline flex-shrink-0">
          ← Pedidos
        </Link>
      </div>

      {/* Status stepper */}
      {!['refunded', 'fulfilled'].includes(currentStatus) && (
        <div className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
          <StatusStepper status={currentStatus} />
        </div>
      )}

      {/* Product + amount */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
            {thumb
              ? <img src={thumb} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
            }
          </div>
          <div className="flex-1">
            <Link href={`/l/${listing?.id}`}
              className="font-semibold text-sm hover:text-[var(--color-accent)] no-underline">
              {listing?.title}
            </Link>
            <p className="text-xs text-[var(--color-muted)] mt-0.5 capitalize">{listing?.listing_type}</p>
            <p className="text-xl font-bold mt-2">{formatPrice(order.amount_cents, order.currency)}</p>
          </div>
        </div>
      </section>

      {/* Buyer info */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <h2 className="font-semibold text-sm text-[var(--color-muted)] uppercase tracking-wide mb-3">Comprador</h2>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-muted)] w-24 flex-shrink-0 text-xs">Nombre</span>
            <span className="font-medium">{order.buyer_name ?? '—'}</span>
          </div>
          {order.shipping_address && Object.keys(order.shipping_address).length > 0 && (
            <div className="flex items-start gap-2 mt-2 pt-2 border-t border-[var(--color-border)]">
              <span className="text-[var(--color-muted)] w-24 flex-shrink-0 text-xs mt-0.5">Dirección</span>
              <span className="text-sm leading-snug">{formatAddress(order.shipping_address)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Shipping section — only for physical products */}
      {listing?.listing_type === 'product' && (
        <div className="mb-5">
          <ShippingSection
            orderId={order.id}
            shippingAddress={order.shipping_address}
            existingShipment={currentShipment}
            onShipped={handleShipped}
          />
        </div>
      )}

      {/* SPEI/cash: seller confirm payment received */}
      {isSpeiOrder && !paymentReceived && (
        <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-amber-800 mb-1">Pedido pendiente de pago</p>
          <p className="text-xs text-amber-700 mb-3">
            El comprador seleccionó SPEI/transferencia. Confirma cuando recibas el depósito en tu cuenta bancaria.
          </p>
          <button
            type="button"
            onClick={handleConfirmPayment}
            disabled={confirmingPayment}
            className="w-full bg-amber-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {confirmingPayment ? 'Confirmando…' : '✓ Confirmar pago recibido'}
          </button>
        </div>
      )}
      {isSpeiOrder && paymentReceived && (
        <div className="border border-green-200 bg-green-50/50 rounded-xl p-3 mb-5">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <p className="text-sm font-semibold text-green-800">Pago por SPEI confirmado</p>
          </div>
        </div>
      )}

      {/* Escrow: seller can manually release funds */}
      {isEscrowOrder && !escrowCaptured && ['delivered', 'completed'].includes(currentStatus) && (
        <div className="border border-purple-200 bg-purple-50/50 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <span>🔒</span>
            <p className="text-sm font-semibold text-purple-800">Pago en custodia (escrow)</p>
          </div>
          <p className="text-xs text-purple-700 mb-3">
            El pago está retenido hasta que el comprador confirme la recepción. Si el comprador no responde en 3 días después de la entrega, el pago se libera automáticamente.
          </p>
          <button
            type="button"
            onClick={handleReleaseEscrow}
            disabled={releasingEscrow}
            className="w-full border border-purple-400 text-purple-700 py-2.5 rounded-lg text-sm font-semibold hover:bg-purple-100 disabled:opacity-50 transition-colors"
          >
            {releasingEscrow ? 'Liberando…' : '🔓 Liberar pago manualmente'}
          </button>
        </div>
      )}
      {isEscrowOrder && escrowCaptured && (
        <div className="border border-green-200 bg-green-50/50 rounded-xl p-3 mb-5">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <p className="text-sm font-semibold text-green-800">Pago de escrow liberado</p>
          </div>
        </div>
      )}

      {/* ── Delivery method banners ────────────────────────────────────────── */}
      {isPickupOrder && !['delivered','completed','refunded'].includes(currentStatus) && (
        <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4 mb-5">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">📍 Recolección en mano</p>
          <p className="text-sm text-amber-800 mb-3">El comprador irá a recogerte el artículo. Confírmale el horario y lugar por correo o mensaje.</p>
          {order.buyer_email && (
            <a
              href={`mailto:${order.buyer_email}?subject=Tu pedido en Miyagi Sánchez — ${listing?.title ?? 'tu artículo'}&body=Hola ${order.buyer_name ?? ''}, escríbeme para coordinar cuándo puedes venir a recoger tu pedido.`}
              className="inline-flex text-sm font-semibold text-amber-800 border border-amber-300 rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors mr-2"
            >
              ✉ Escribir al comprador
            </a>
          )}
          {currentStatus !== 'delivered' && (
            <button type="button" onClick={() => updateStatus('delivered')} disabled={updatingStatus}
              className="text-sm font-semibold text-green-700 border border-green-200 rounded-lg px-4 py-2 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors">
              {updatingStatus ? 'Actualizando…' : '✓ Confirmar entrega en mano'}
            </button>
          )}
        </div>
      )}

      {isCoordOrder && !['delivered','completed','refunded'].includes(currentStatus) && (
        <div className="border border-purple-200 bg-purple-50/60 rounded-xl p-4 mb-5">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">🤝 Entrega acordada</p>
          <p className="text-sm text-purple-800 mb-3">El comprador espera que te contactes para acordar cómo y cuándo recibe el artículo. Tienes 24 h para escribirle.</p>
          {order.buyer_email && (
            <a
              href={`mailto:${order.buyer_email}?subject=Tu pedido en Miyagi Sánchez — ${listing?.title ?? 'tu artículo'}&body=Hola ${order.buyer_name ?? ''}, compré tu artículo y quiero coordinarte la entrega.`}
              className="inline-flex text-sm font-semibold text-purple-800 border border-purple-300 rounded-lg px-4 py-2 hover:bg-purple-100 transition-colors mr-2"
            >
              ✉ Contactar al comprador
            </a>
          )}
          {['shipped', 'in_transit', 'processing'].includes(currentStatus) && (
            <button type="button" onClick={() => updateStatus('delivered')} disabled={updatingStatus}
              className="text-sm font-semibold text-green-700 border border-green-200 rounded-lg px-4 py-2 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors">
              {updatingStatus ? 'Actualizando…' : '✓ Confirmar entregado'}
            </button>
          )}
        </div>
      )}

      {/* Quick status actions */}
      {currentStatus === 'paid' && (
        <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 mb-5">
          <p className="text-sm font-medium text-blue-800 mb-3">
            {isPickupOrder ? '¿Ya tienes el artículo listo para entregar?' : isCoordOrder ? '¿Ya contactaste al comprador?' : '¿Ya preparaste el pedido?'}
          </p>
          <button type="button" onClick={() => updateStatus('processing')} disabled={updatingStatus}
            className="text-sm font-semibold text-blue-700 border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-100 disabled:opacity-50 transition-colors">
            {updatingStatus ? 'Actualizando…' : '✓ Marcar como "En preparación"'}
          </button>
        </div>
      )}

      {['shipped', 'in_transit'].includes(currentStatus) && !isPickupOrder && !isCoordOrder && (
        <div className="border border-[var(--color-border)] rounded-xl p-4 mb-5">
          <p className="text-sm font-medium mb-3">¿El comprador ya lo recibió?</p>
          <button type="button" onClick={() => updateStatus('delivered')} disabled={updatingStatus}
            className="text-sm font-semibold text-green-700 border border-green-200 rounded-lg px-4 py-2 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors">
            {updatingStatus ? 'Actualizando…' : '✓ Marcar como entregado'}
          </button>
        </div>
      )}

      {/* Return request — load nudge */}
      {!returnLoaded && ['delivered', 'completed', 'refunded'].includes(currentStatus) && (
        <button
          type="button"
          onClick={loadReturnRequest}
          className="w-full text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] border-dashed rounded-xl px-4 py-3 text-left flex items-center gap-2 mb-5 transition-colors hover:bg-[var(--color-surface-alt)]"
        >
          <span>↩</span>
          <span>Ver solicitudes de devolución</span>
        </button>
      )}

      {/* Return request panel */}
      {showReturnPanel && returnRequest && (
        <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm text-[var(--color-muted)] uppercase tracking-wide">Solicitud de devolución</h2>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${RETURN_STATUS_META[returnRequest.status]?.badge ?? 'bg-gray-100 text-gray-600'}`}>
              {RETURN_STATUS_META[returnRequest.status]?.label ?? returnRequest.status}
            </span>
          </div>

          <div className="space-y-1.5 text-sm mb-4">
            <div className="flex items-start gap-2">
              <span className="text-xs text-[var(--color-muted)] w-24 flex-shrink-0 mt-0.5">Motivo</span>
              <span className="font-medium">{RETURN_REASON_LABELS[returnRequest.reason] ?? returnRequest.reason}</span>
            </div>
            {returnRequest.description && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-[var(--color-muted)] w-24 flex-shrink-0 mt-0.5">Descripción</span>
                <span className="text-sm italic text-[var(--color-muted)]">&ldquo;{returnRequest.description}&rdquo;</span>
              </div>
            )}
          </div>

          {/* Pending — action panel */}
          {returnRequest.status === 'pending' && (
            <div className="border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-medium text-[var(--color-muted)] mb-3">Responde a esta solicitud</p>
              <div className="mb-3">
                <label className="text-xs text-[var(--color-muted)] block mb-1">Nota para el comprador <span className="font-normal">(opcional)</span></label>
                <textarea
                  value={returnSellerNote}
                  onChange={e => setReturnSellerNote(e.target.value)}
                  rows={2}
                  placeholder="Ej. Puedes enviar el artículo a la dirección que te indiqué por correo."
                  className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                />
              </div>

              <div className="mb-3">
                <label className="text-xs text-[var(--color-muted)] block mb-1">Reembolso parcial — monto (MXN)</label>
                <input
                  type="number"
                  min="1"
                  max={order.amount_cents / 100}
                  step="0.01"
                  value={partialRefundCents}
                  onChange={e => setPartialRefundCents(e.target.value)}
                  placeholder={`Máx. $${(order.amount_cents / 100).toFixed(0)}`}
                  className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleReturnAction('accept')}
                  disabled={processingReturn}
                  className="text-xs font-semibold py-2.5 rounded-lg border-2 border-green-400 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                >
                  ✓ Reembolso total
                </button>
                <button
                  type="button"
                  onClick={() => handleReturnAction('partial_refund')}
                  disabled={processingReturn || !partialRefundCents}
                  className="text-xs font-semibold py-2.5 rounded-lg border-2 border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                >
                  ~ Parcial
                </button>
                <button
                  type="button"
                  onClick={() => handleReturnAction('decline')}
                  disabled={processingReturn}
                  className="text-xs font-semibold py-2.5 rounded-lg border-2 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  ✕ Rechazar
                </button>
              </div>

              {processingReturn && (
                <p className="text-xs text-center text-[var(--color-muted)] mt-2">Procesando…</p>
              )}

              {/* AI agent handoff — an agent can evaluate and process the refund for the seller */}
              <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                <AgentHandoff
                  title="Los agentes pueden iniciar y resolver reembolsos por ti"
                  subtitle="Pásale esta solicitud a un agente IA para que evalúe el caso, decida entre reembolso total, parcial o rechazo, y lo ejecute con una nota para el comprador."
                  prompt={`Soy el vendedor en Miyagi Sánchez. Asísteme a resolver una solicitud de devolución/reembolso del pedido ${order.id}${listing?.title ? ` ("${listing.title}")` : ''}.\n\nLee la ficha del marketplace en https://miyagisanchez.com/agent y conéctate al servidor MCP. Revisa la solicitud del comprador, recomiéndame una resolución (reembolso total, parcial o rechazo) con una nota para el comprador, y ejecútala cuando la apruebe.\n\nEl pedido: https://miyagisanchez.com/shop/manage/orders/${order.id}`}
                />
              </div>
            </div>
          )}

          {/* Resolved */}
          {returnRequest.status !== 'pending' && returnRequest.seller_note && (
            <div className="border-t border-[var(--color-border)] pt-3 mt-2">
              <p className="text-xs text-[var(--color-muted)]">Tu nota: <em>{returnRequest.seller_note}</em></p>
            </div>
          )}
        </section>
      )}

      {/* ── Seller-initiated refund ──────────────────────────────────────────── */}
      {refundIssued && (
        <div className="border border-green-200 bg-green-50/50 rounded-xl p-3 mb-5">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <p className="text-sm font-semibold text-green-800">Reembolso emitido al comprador</p>
          </div>
        </div>
      )}

      {canInitiateRefund && (
        <div className="border border-[var(--color-border)] rounded-xl p-4 mb-5">
          {!showInitiateRefund ? (
            <>
              <p className="text-sm font-semibold mb-1">¿Necesitas reembolsar este pedido?</p>
              <p className="text-xs text-[var(--color-muted)] mb-3">
                Emite un reembolso al comprador sin esperar a que abra una solicitud — por ejemplo si no puedes
                cumplir el pedido o ya lo acordaron por mensaje. El comprador recibirá una notificación.
              </p>
              <button
                type="button"
                onClick={() => setShowInitiateRefund(true)}
                className="text-sm font-semibold text-red-600 border border-red-200 rounded-lg px-4 py-2 bg-red-50 hover:bg-red-100 transition-colors"
              >
                ↩ Iniciar reembolso
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold mb-3">Iniciar reembolso</p>

              <div className="mb-3">
                <label className="text-xs text-[var(--color-muted)] block mb-1">
                  Monto a reembolsar (MXN) <span className="font-normal">— déjalo vacío para reembolso total</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={order.amount_cents / 100}
                  step="0.01"
                  value={initiateAmount}
                  onChange={e => setInitiateAmount(e.target.value)}
                  placeholder={`Total: $${orderTotalPesos}`}
                  className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                />
              </div>

              <div className="mb-3">
                <label className="text-xs text-[var(--color-muted)] block mb-1">Nota para el comprador <span className="font-normal">(opcional)</span></label>
                <textarea
                  value={initiateNote}
                  onChange={e => setInitiateNote(e.target.value)}
                  rows={2}
                  placeholder="Ej. No pude conseguir el artículo, te reembolso el total. ¡Disculpa la molestia!"
                  className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInitiateRefund}
                  disabled={initiatingRefund}
                  className="flex-1 text-sm font-semibold py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {initiatingRefund ? 'Emitiendo…' : initiateAmount.trim() ? 'Emitir reembolso parcial' : 'Emitir reembolso total'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowInitiateRefund(false)}
                  disabled={initiatingRefund}
                  className="px-4 py-2.5 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>

              <p className="text-[11px] text-[var(--color-muted)] mt-2">
                {isEscrowOrder && !escrowCaptured
                  ? 'El pago está en custodia y aún no se cobra — se anulará la retención, sin movimiento de dinero.'
                  : isSpeiOrder
                  ? 'Pago por SPEI/efectivo: deberás devolver el dinero por transferencia. Esto solo registra el reembolso.'
                  : 'El reembolso se procesa al instante en la tarjeta del comprador (5–10 días hábiles según su banco).'}
              </p>
            </>
          )}
        </div>
      )}

      {/* AI tip */}
      {canShip && (
        <div className="flex items-start gap-2.5 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl px-4 py-3">
          <span className="text-base mt-0.5 flex-shrink-0">✦</span>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            <strong className="text-[var(--color-text)]">Tip:</strong> Incluye una nota de agradecimiento dentro del paquete.
            Los compradores que reciben una nota califican con 5 estrellas un 40% más seguido.
          </p>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}
