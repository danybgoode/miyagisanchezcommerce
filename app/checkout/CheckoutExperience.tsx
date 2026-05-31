'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

type PostalLookupResult = {
  zipCode: string
  stateCode: string
  stateName: string
  alcaldia: string
  colonias: string[]
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
    ext_number: '',
    int_number: '',
    line2: '',
    city: '',
    state: '',
    state_code: '',
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
  const [address, setAddress] = useState<CheckoutShippingAddress>(blankAddress)

  // CP-first lookup state
  const [cpLookupLoading, setCpLookupLoading] = useState(false)
  const [cpLookupError, setCpLookupError]     = useState<string | null>(null)
  const [cpResult, setCpResult]               = useState<PostalLookupResult | null>(null)
  const cpLookupRef = useRef<AbortController | null>(null)

  const [shippingRates, setShippingRates]               = useState<ShippingRate[]>([])
  const [selectedShippingRateId, setSelectedShippingRateId] = useState<string | null>(null)
  const [shippingRatesLoading, setShippingRatesLoading] = useState(false)
  const [shippingRatesError, setShippingRatesError]     = useState<string | null>(null)
  const [shippingRatesMessage, setShippingRatesMessage] = useState<string | null>(null)

  const selectedDelivery = useMemo(
    () => deliveryOptions.find(o => o.id === selectedDeliveryId) ?? deliveryOptions[0],
    [deliveryOptions, selectedDeliveryId],
  )
  const selectedPayment = useMemo(
    () => paymentOptions.find(o => o.id === selectedPaymentId) ?? paymentOptions[0],
    [paymentOptions, selectedPaymentId],
  )

  const cpResolved = Boolean(cpResult?.stateCode)

  // Address is ready when all required structural fields are filled
  const addressReady = !selectedDelivery?.requiresAddress || Boolean(
    address.name?.trim() &&
    address.line1?.trim() &&         // calle
    address.ext_number?.trim() &&    // número exterior
    address.state_code?.trim() &&
    address.postal_code?.trim()
  )

  const needsShippingRate = selectedDelivery?.id === 'shipping' && !!selectedDelivery.requiresAddress
  const selectedShippingRate = useMemo(
    () => shippingRates.find(r => r.id === selectedShippingRateId) ?? null,
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
  const totalCents = amountCents + (selectedShippingRate?.amountCents ?? 0)
  const canPay = Boolean(selectedDelivery && selectedPayment && addressReady && (!needsShippingRate || selectedShippingRate))

  // ── CP-first lookup ────────────────────────────────────────────────────────
  function handleCpChange(value: string) {
    const cp = value.replace(/\D/g, '').slice(0, 5)
    setAddress(a => ({ ...a, postal_code: cp, state: '', state_code: '', city: '', line2: '' }))
    setCpResult(null)
    setCpLookupError(null)
    if (cp.length < 5) return

    cpLookupRef.current?.abort()
    const ctrl = new AbortController()
    cpLookupRef.current = ctrl
    setCpLookupLoading(true)

    fetch('/api/checkout/postal-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cp }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then((data: PostalLookupResult & { error?: string }) => {
        if (ctrl.signal.aborted) return
        if (data.error) { setCpLookupError(data.error); return }
        setCpResult(data)
        setAddress(a => ({
          ...a,
          postal_code: data.zipCode,
          state: data.stateName,
          state_code: data.stateCode,
          city: data.alcaldia,   // alcaldía/municipio from region_2
          line2: '',             // reset colonia so buyer picks from dropdown
        }))
      })
      .catch(e => {
        if (ctrl.signal.aborted) return
        setCpLookupError('No se pudo validar el código postal.')
        console.error('[postal-lookup]', e)
      })
      .finally(() => { if (!ctrl.signal.aborted) setCpLookupLoading(false) })
  }

  // ── Quote shipping rates ───────────────────────────────────────────────────
  useEffect(() => {
    if (!needsShippingRate || !addressReady) return

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setShippingRatesLoading(true)
      setShippingRatesError(null)
      setShippingRatesMessage(null)
      try {
        const res = await fetch('/api/checkout/shipping-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId, address }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => null) as { rates?: ShippingRate[]; error?: string; message?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'No se pudo cotizar el envío.')
        const rates = data?.rates ?? []
        setShippingRates(rates)
        setSelectedShippingRateId(rates[0]?.id ?? null)
        if (rates.length === 0) setShippingRatesMessage(data?.message ?? 'Las paqueterías no tienen cobertura para ese destino.')
      } catch (err) {
        if (controller.signal.aborted) return
        setShippingRates([])
        setSelectedShippingRateId(null)
        setShippingRatesError(err instanceof Error ? err.message : 'No se pudo cotizar el envío.')
      } finally {
        if (!controller.signal.aborted) setShippingRatesLoading(false)
      }
    }, 450)

    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [needsShippingRate, addressReady, listingId, address])

  return (
    <>
      {/* ── Delivery section ───────────────────────────────────────────────── */}
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

        {/* ── Address form ─────────────────────────────────────────────────── */}
        {selectedDelivery?.requiresAddress && (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>

            {/* Name + Phone */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input value={address.name ?? ''} onChange={e => setAddress({ ...address, name: e.target.value })} placeholder="Nombre de quien recibe" style={inputStyle} />
              <input value={address.phone ?? ''} onChange={e => setAddress({ ...address, phone: e.target.value })} placeholder="Teléfono" inputMode="tel" style={inputStyle} />
            </div>

            {/* CP — anchor of the whole form */}
            <div>
              <div style={{ position: 'relative' }}>
                <input
                  value={address.postal_code ?? ''}
                  onChange={e => handleCpChange(e.target.value)}
                  placeholder="Código postal (CP)"
                  inputMode="numeric"
                  maxLength={5}
                  style={{
                    ...inputStyle,
                    paddingRight: 34,
                    border: `1px solid ${cpLookupError ? 'var(--danger, #dc2626)' : cpResolved ? 'var(--success, #16a34a)' : 'var(--border)'}`,
                  }}
                />
                {cpLookupLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--fg-subtle)', animation: 'pulse 1s infinite' }}>·</span>}
                {cpResolved && !cpLookupLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--success, #16a34a)' }}>✓</span>}
              </div>
              {cpLookupError && <p style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 4 }}>{cpLookupError}</p>}
              {!cpResolved && !cpLookupError && !address.postal_code?.length && (
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>Empieza con tu código postal — llenamos estado, alcaldía y colonias.</p>
              )}
            </div>

            {/* Estado + Alcaldía — auto-filled and locked by CP */}
            {cpResolved && cpResult && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 3 }}>Estado</p>
                    <div style={{ ...inputStyle, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--success, #16a34a)' }}>✓</span>
                      <span style={{ fontSize: 13 }}>{cpResult.stateName}</span>
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 3 }}>Alcaldía / Municipio</p>
                    <div style={{ ...inputStyle, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--success, #16a34a)' }}>✓</span>
                      <span style={{ fontSize: 13 }}>{cpResult.alcaldia}</span>
                    </div>
                  </div>
                </div>

                {/* Colonia dropdown */}
                {cpResult.colonias.length > 0 && (
                  <select
                    value={address.line2 ?? ''}
                    onChange={e => setAddress({ ...address, line2: e.target.value })}
                    style={inputStyle as CSSProperties}
                  >
                    <option value="">Selecciona colonia</option>
                    {cpResult.colonias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </>
            )}

            {/* Street fields — only show once CP is resolved */}
            {cpResolved && (
              <>
                {/* Calle */}
                <input
                  value={address.line1 ?? ''}
                  onChange={e => setAddress({ ...address, line1: e.target.value })}
                  placeholder="Calle"
                  style={inputStyle}
                />

                {/* No. exterior + No. interior */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input
                    value={address.ext_number ?? ''}
                    onChange={e => setAddress({ ...address, ext_number: e.target.value })}
                    placeholder="No. exterior"
                    style={inputStyle}
                  />
                  <input
                    value={address.int_number ?? ''}
                    onChange={e => setAddress({ ...address, int_number: e.target.value })}
                    placeholder="No. interior (opcional)"
                    style={inputStyle}
                  />
                </div>
              </>
            )}

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
                    <p style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginBottom: 4 }}>{shippingRatesError}</p>
                    <p style={{ fontSize: 11, color: 'var(--fg-muted)' }}>También puedes coordinar la entrega directamente con el vendedor.</p>
                  </div>
                )}

                {shippingRatesMessage && !shippingRatesLoading && shippingRates.length === 0 && !shippingRatesError && (
                  <div style={{ background: 'var(--warning-soft, #fffbeb)', border: '1px solid var(--warning, #d97706)', borderRadius: 8, padding: 10 }}>
                    <p style={{ fontSize: 12, color: 'var(--warning, #92400e)' }}>{shippingRatesMessage}</p>
                  </div>
                )}

                {shippingRates.map(rate => {
                  const active = selectedShippingRateId === rate.id
                  return (
                    <button key={rate.id} type="button" onClick={() => setSelectedShippingRateId(rate.id)} style={optionButtonStyle(active)}>
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

      {/* ── Payment section ────────────────────────────────────────────────── */}
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Elige pago</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {paymentOptions.map(option => (
            <button key={option.id} type="button" onClick={() => setSelectedPaymentId(option.id)} style={optionButtonStyle(selectedPayment?.id === option.id)}>
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

      {/* ── Summary section ────────────────────────────────────────────────── */}
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
                {selectedShippingRate
                  ? `${selectedShippingRate.carrier.toUpperCase()} ${formatCents(selectedShippingRate.amountCents, selectedShippingRate.currency)}`
                  : 'Selecciona una tarifa'}
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
