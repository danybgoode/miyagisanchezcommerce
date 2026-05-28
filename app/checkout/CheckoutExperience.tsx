'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import CheckoutPayButton from '@/app/components/CheckoutPayButton'
import type { CheckoutFulfillmentMethod, CheckoutProvider, CheckoutShippingAddress, CheckoutShippingQuote } from '@/lib/cart'

export type DeliveryOption = {
  id: CheckoutFulfillmentMethod
  label: string
  note: string
  detail?: string | null
  pickupSpotId?: string
  requiresAddress?: boolean
}

export type PaymentOption = {
  id: CheckoutProvider
  label: string
  note: string
}

export type ManualOption = {
  id: string
  label: string
  note: string
  detail?: string | null
  href?: string | null
}

type ShippingRate = {
  id: string
  rateId: string
  carrier: string
  service: string
  amountCents: number
  currency: string
  deliveryEstimate: number | null
  deliveryLabel: string | null
  logoUrl?: string | null
}

function optionButtonStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    width: '100%',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    textAlign: 'left',
    borderRadius: 8,
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--bg-sunk)',
    color: 'var(--fg)',
  }
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function blankAddress(): CheckoutShippingAddress {
  return {
    country: 'MX',
    name: '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal_code: '',
  }
}

export default function CheckoutExperience({
  listingId,
  sellerId,
  amountCents,
  currency,
  deliveryOptions,
  paymentOptions,
  manualOptions,
  offerId,
  offerAmountCents,
}: {
  listingId: string
  sellerId: string
  amountCents: number
  currency: string
  deliveryOptions: DeliveryOption[]
  paymentOptions: PaymentOption[]
  manualOptions: ManualOption[]
  offerId?: string
  offerAmountCents?: number
}) {
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<CheckoutFulfillmentMethod>(
    deliveryOptions[0]?.id ?? 'none',
  )
  const [selectedPaymentId, setSelectedPaymentId] = useState<CheckoutProvider>(
    paymentOptions[0]?.id ?? 'stripe',
  )
  const [address, setAddress] = useState<CheckoutShippingAddress>(() => blankAddress())
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([])
  const [selectedShippingRateId, setSelectedShippingRateId] = useState<string | null>(null)
  const [shippingRatesLoading, setShippingRatesLoading] = useState(false)
  const [shippingRatesError, setShippingRatesError] = useState<string | null>(null)

  const selectedDelivery = useMemo(
    () => deliveryOptions.find(option => option.id === selectedDeliveryId) ?? deliveryOptions[0],
    [deliveryOptions, selectedDeliveryId],
  )
  const selectedPayment = useMemo(
    () => paymentOptions.find(option => option.id === selectedPaymentId) ?? paymentOptions[0],
    [paymentOptions, selectedPaymentId],
  )

  const addressReady = !selectedDelivery?.requiresAddress || Boolean(
    address.name?.trim() &&
    address.line1?.trim() &&
    address.city?.trim() &&
    address.state?.trim() &&
    address.postal_code?.trim(),
  )
  const needsShippingRate = Boolean(selectedDelivery?.id === 'shipping' && selectedDelivery.requiresAddress)
  const selectedShippingRate = useMemo(
    () => shippingRates.find(rate => rate.id === selectedShippingRateId) ?? null,
    [shippingRates, selectedShippingRateId],
  )
  const selectedShippingQuote: CheckoutShippingQuote | undefined = selectedShippingRate
    ? {
        rateId: selectedShippingRate.rateId,
        carrier: selectedShippingRate.carrier,
        service: selectedShippingRate.service,
        amountCents: selectedShippingRate.amountCents,
        currency: selectedShippingRate.currency,
        deliveryEstimate: selectedShippingRate.deliveryEstimate,
        deliveryLabel: selectedShippingRate.deliveryLabel,
      }
    : undefined
  const shippingAmountCents = selectedShippingRate?.amountCents ?? 0
  const totalCents = amountCents + shippingAmountCents
  const canPay = Boolean(selectedDelivery && selectedPayment && addressReady && (!needsShippingRate || selectedShippingRate))

  useEffect(() => {
    if (!needsShippingRate || !addressReady) return

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setShippingRatesLoading(true)
      setShippingRatesError(null)
      try {
        const res = await fetch('/api/checkout/shipping-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId, address }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => null) as { rates?: ShippingRate[]; error?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'No se pudo cotizar el envio.')
        const rates = data?.rates ?? []
        setShippingRates(rates)
        setSelectedShippingRateId(rates[0]?.id ?? null)
        if (rates.length === 0) setShippingRatesError('No encontramos tarifas para esa direccion.')
      } catch (err) {
        if (controller.signal.aborted) return
        setShippingRates([])
        setSelectedShippingRateId(null)
        setShippingRatesError(err instanceof Error ? err.message : 'No se pudo cotizar el envio.')
      } finally {
        if (!controller.signal.aborted) setShippingRatesLoading(false)
      }
    }, 450)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [
    needsShippingRate,
    addressReady,
    listingId,
    address,
  ])

  return (
    <>
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Elige entrega</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {deliveryOptions.map(option => (
            <button
              key={`${option.id}-${option.pickupSpotId ?? ''}`}
              type="button"
              onClick={() => setSelectedDeliveryId(option.id)}
              style={optionButtonStyle(selectedDelivery?.id === option.id && selectedDelivery?.pickupSpotId === option.pickupSpotId)}
            >
              <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: `5px solid ${selectedDelivery?.id === option.id ? 'var(--accent)' : 'var(--border)'}`, flexShrink: 0, marginTop: 1 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{option.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</span>
                {option.detail && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2 }}>{option.detail}</span>}
              </span>
            </button>
          ))}
        </div>

        {selectedDelivery?.requiresAddress && (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input value={address.name ?? ''} onChange={e => setAddress({ ...address, name: e.target.value })} placeholder="Nombre de quien recibe" style={inputStyle} />
              <input value={address.phone ?? ''} onChange={e => setAddress({ ...address, phone: e.target.value })} placeholder="Teléfono" style={inputStyle} />
            </div>
            <input value={address.line1 ?? ''} onChange={e => setAddress({ ...address, line1: e.target.value })} placeholder="Calle y número" style={inputStyle} />
            <input value={address.line2 ?? ''} onChange={e => setAddress({ ...address, line2: e.target.value })} placeholder="Colonia / referencias" style={inputStyle} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10 }}>
              <input value={address.city ?? ''} onChange={e => setAddress({ ...address, city: e.target.value })} placeholder="Ciudad" style={inputStyle} />
              <input value={address.state ?? ''} onChange={e => setAddress({ ...address, state: e.target.value })} placeholder="Estado" style={inputStyle} />
              <input value={address.postal_code ?? ''} onChange={e => setAddress({ ...address, postal_code: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="CP" style={inputStyle} />
            </div>
            {!addressReady && <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Completa la dirección para continuar.</p>}
            {addressReady && needsShippingRate && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-muted)' }}>Opciones de paquetería</p>
                  {shippingRatesLoading && <p style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Cotizando...</p>}
                </div>

                {shippingRatesLoading && shippingRates.length === 0 && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {[0, 1].map(i => (
                      <div key={i} style={{ height: 58, borderRadius: 8, background: 'var(--bg-sunk)', border: '1px solid var(--border)', opacity: 0.75 }} />
                    ))}
                  </div>
                )}

                {shippingRatesError && !shippingRatesLoading && (
                  <div style={{ background: 'var(--danger-soft, #fef2f2)', border: '1px solid var(--danger, #dc2626)', borderRadius: 8, padding: 10 }}>
                    <p style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>{shippingRatesError}</p>
                  </div>
                )}

                {shippingRates.map(rate => {
                  const active = selectedShippingRateId === rate.id
                  return (
                    <button
                      key={rate.id}
                      type="button"
                      onClick={() => setSelectedShippingRateId(rate.id)}
                      style={optionButtonStyle(active)}
                    >
                      <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: `5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, flexShrink: 0, marginTop: 1 }} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{rate.carrier.toUpperCase()} · {rate.service}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                          {rate.deliveryLabel ? `Entrega estimada: ${rate.deliveryLabel}` : 'Entrega estimada por paquetería'}
                        </span>
                      </span>
                      <strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{formatCents(rate.amountCents, rate.currency)}</strong>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Elige pago</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {paymentOptions.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedPaymentId(option.id)}
              style={optionButtonStyle(selectedPayment?.id === option.id)}
            >
              <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: `5px solid ${selectedPayment?.id === option.id ? 'var(--accent)' : 'var(--border)'}`, flexShrink: 0, marginTop: 1 }} />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{option.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</span>
              </span>
            </button>
          ))}
        </div>

        {manualOptions.length > 0 && (
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-muted)' }}>Métodos manuales del vendedor</p>
            {manualOptions.map(option => (
              <div key={option.id} style={{ padding: 10, background: 'var(--bg-sunk)', borderRadius: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700 }}>{option.label}</p>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</p>
                {option.detail && <p style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2, overflowWrap: 'anywhere' }}>{option.detail}</p>}
                {option.href && <a href={option.href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>Abrir enlace</a>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Resumen</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Producto</span>
            <strong>{formatCents(amountCents, currency)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Entrega</span>
            <strong>{selectedDelivery?.label ?? 'Por coordinar'}</strong>
          </div>
          {needsShippingRate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 12 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Envío</span>
              <strong style={{ textAlign: 'right' }}>
                {selectedShippingRate ? `${selectedShippingRate.carrier.toUpperCase()} ${formatCents(selectedShippingRate.amountCents, selectedShippingRate.currency)}` : 'Selecciona una tarifa'}
              </strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Pago</span>
            <strong>{selectedPayment?.label ?? 'No disponible'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Comisión Miyagi</span>
            <strong>$0</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
            <span style={{ fontWeight: 800 }}>Total</span>
            <strong>{formatCents(totalCents, currency)}</strong>
          </div>
        </div>

        {selectedPayment ? (
          <CheckoutPayButton
            provider={selectedPayment.id}
            listingId={listingId}
            sellerId={sellerId}
            amountCents={amountCents}
            currency={currency}
            offerId={offerId}
            offerAmountCents={offerAmountCents}
            fulfillmentMethod={selectedDelivery?.id ?? 'none'}
            pickupSpotId={selectedDelivery?.pickupSpotId}
            shippingAddress={selectedDelivery?.requiresAddress ? address : undefined}
            shippingQuote={needsShippingRate ? selectedShippingQuote : undefined}
            disabled={!canPay}
          />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Este vendedor todavía no tiene pagos en línea activos.</p>
        )}
      </section>
    </>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--fg)',
  padding: '10px 12px',
  fontSize: 13,
}
