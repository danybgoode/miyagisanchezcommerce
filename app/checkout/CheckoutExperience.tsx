'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import CheckoutPayButton from '@/app/components/CheckoutPayButton'
import type { CartItem } from '@/app/components/CartContext'
import type { CheckoutFulfillmentMethod, CheckoutProvider, ManualSubType, CheckoutShippingAddress, CheckoutShippingQuote } from '@/lib/cart'
import { type PersonalizationPayload, formatPersonalizationLines, readStashedPersonalization } from '@/lib/personalization'
import { computeCheckoutTotal } from '@/lib/checkout-total'

// ── Shapes returned by /api/checkout/options (Medusa source of truth) ────────
type PickupSpot = { id: string; name?: string; address?: string; hours?: string; scheduling_url?: string; notes?: string }
type DeliveryMethod = {
  id: CheckoutFulfillmentMethod
  label: string
  note: string
  requires_address?: boolean
  requires_pickup_spot?: boolean
  pickup_spots?: PickupSpot[]
}
type ManualSubOption = { type: ManualSubType; label: string; note: string; requires_pickup?: boolean }
type PaymentMethod = { id: CheckoutProvider; kind: 'online' | 'manual'; label: string; note: string; instant: boolean; protected?: boolean; sub_options?: ManualSubOption[] }
type CheckoutOptions = {
  payment_methods: PaymentMethod[]
  payment_default: CheckoutProvider | null
  delivery_methods: DeliveryMethod[]
  delivery_default: CheckoutFulfillmentMethod | null
  only_coordinated: boolean
  preparation: string | null
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

function radioDot(active: boolean): CSSProperties {
  return { width: 18, height: 18, borderRadius: '50%', border: `5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, flexShrink: 0, marginTop: 1 }
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function blankAddress(): CheckoutShippingAddress {
  return { country: 'MX', name: '', phone: '', line1: '', ext_number: '', int_number: '', line2: '', city: '', state: '', state_code: '', postal_code: '' }
}

export default function CheckoutExperience({
  sellerId,
  listingId,
  items,
  amountCents,
  currency,
  offerId,
  offerAmountCents,
  listingType = 'product',
  isDigital = false,
  originDomain,
  onStarted,
}: {
  sellerId: string
  listingId?: string
  items?: CartItem[]
  amountCents: number
  currency: string
  offerId?: string
  offerAmountCents?: number
  listingType?: string
  isDigital?: boolean
  originDomain?: string
  onStarted?: () => void
}) {
  // ── Fetch checkout options from Medusa (single source of truth) ───────────
  const [options, setOptions] = useState<CheckoutOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)

  // Personalization the buyer entered in the PDP buy box, stashed for hand-off
  // (single-item path). Bundle items carry their own payload on the CartItem.
  const [personalization, setPersonalization] = useState<PersonalizationPayload | null>(null)
  useEffect(() => {
    if (listingId) setPersonalization(readStashedPersonalization(listingId))
  }, [listingId])

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ sellerId, listingType, isDigital: String(isDigital) })
    fetch(`/api/checkout/options?${qs}`)
      .then(r => r.json())
      .then((data: CheckoutOptions & { error?: string }) => {
        if (cancelled) return
        if (data.error) { setOptionsError(data.error); return }
        setOptions(data)
        setSelectedDeliveryId(data.delivery_default ?? data.delivery_methods[0]?.id ?? 'none')
        setSelectedPaymentId(data.payment_default ?? data.payment_methods[0]?.id ?? null)
      })
      .catch(() => { if (!cancelled) setOptionsError('No se pudieron cargar las opciones de pago.') })
    return () => { cancelled = true }
  }, [sellerId, listingType, isDigital])

  const [selectedDeliveryId, setSelectedDeliveryId] = useState<CheckoutFulfillmentMethod>('none')
  const [selectedPickupSpotId, setSelectedPickupSpotId] = useState<string | null>(null)
  const [selectedPaymentId, setSelectedPaymentId] = useState<CheckoutProvider | null>(null)
  const [address, setAddress] = useState<CheckoutShippingAddress>(blankAddress)

  // CP-first lookup state
  const [cpLookupLoading, setCpLookupLoading] = useState(false)
  const [cpLookupError, setCpLookupError] = useState<string | null>(null)
  const [cpResult, setCpResult] = useState<PostalLookupResult | null>(null)
  const cpLookupRef = useRef<AbortController | null>(null)

  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([])
  const [selectedShippingRateId, setSelectedShippingRateId] = useState<string | null>(null)
  const [shippingRatesLoading, setShippingRatesLoading] = useState(false)
  const [shippingRatesError, setShippingRatesError] = useState<string | null>(null)
  const [shippingRatesMessage, setShippingRatesMessage] = useState<string | null>(null)

  // ── Coupon code ───────────────────────────────────────────────────────────
  // Not offered when an accepted offer is in play (coupons don't stack on offers,
  // mirroring the backend rule). Validation is a real-time preview; start-checkout
  // re-checks authoritatively and recomputes the charged amount.
  const couponsAllowed = !offerAmountCents
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountCents: number } | null>(null)
  const [couponValidating, setCouponValidating] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase()
    if (!code) return
    setCouponValidating(true)
    setCouponError(null)
    try {
      const qs = new URLSearchParams({ sellerId, code, itemsCents: String(amountCents) })
      const res = await fetch(`/api/checkout/validate-coupon?${qs}`)
      const data = await res.json() as { valid?: boolean; code?: string; discount_cents?: number; message?: string }
      if (!res.ok || !data.valid) {
        setAppliedCoupon(null)
        setCouponError(data.message ?? 'Cupón no válido.')
        return
      }
      setAppliedCoupon({ code: data.code ?? code, discountCents: data.discount_cents ?? 0 })
      setCouponInput(data.code ?? code)
    } catch {
      setCouponError('No se pudo validar el cupón. Intenta de nuevo.')
    } finally {
      setCouponValidating(false)
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null)
    setCouponInput('')
    setCouponError(null)
  }

  const couponDiscountCents = appliedCoupon?.discountCents ?? 0

  const deliveryMethods = options?.delivery_methods ?? []
  const paymentMethods = options?.payment_methods ?? []

  const selectedDelivery = useMemo(
    () => deliveryMethods.find(o => o.id === selectedDeliveryId) ?? deliveryMethods[0],
    [deliveryMethods, selectedDeliveryId],
  )
  const selectedPayment = useMemo(
    () => paymentMethods.find(o => o.id === selectedPaymentId) ?? null,
    [paymentMethods, selectedPaymentId],
  )

  const cpResolved = Boolean(cpResult?.stateCode)
  const addressReady = !selectedDelivery?.requires_address || Boolean(
    address.name?.trim() && address.line1?.trim() && address.ext_number?.trim() && address.state_code?.trim() && address.postal_code?.trim(),
  )
  const needsShippingRate = selectedDelivery?.id === 'shipping' && !!selectedDelivery.requires_address
  const needsPickupSpot = selectedDelivery?.id === 'local_pickup' && !!selectedDelivery.requires_pickup_spot
  const pickupReady = !needsPickupSpot || !!selectedPickupSpotId

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
  const totalCents = computeCheckoutTotal({
    itemsCents: amountCents,
    couponDiscountCents,
    shippingCents: selectedShippingRate?.amountCents ?? 0,
  })

  // Manual ("Pago directo") — the buyer does NOT pick a sub-type at checkout.
  // We preview what the seller accepts (method + how it works) so they don't commit
  // blind; the exact account numbers appear on the order page after placing. Cash
  // applies only with pickup.
  const isPickup = selectedDelivery?.id === 'local_pickup'
  const isManualPayment = selectedPayment?.kind === 'manual'
  const manualMethods = useMemo(
    () => (isManualPayment ? selectedPayment!.sub_options ?? [] : [])
      .filter(o => o.type !== 'cash' || isPickup),
    [isManualPayment, selectedPayment, isPickup],
  )

  const canPay = Boolean(
    selectedDelivery && selectedPayment && addressReady && pickupReady && (!needsShippingRate || selectedShippingRate),
  )

  // Reset pickup spot selection when delivery method changes.
  useEffect(() => { setSelectedPickupSpotId(null) }, [selectedDeliveryId])

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
        setAddress(a => ({ ...a, postal_code: data.zipCode, state: data.stateName, state_code: data.stateCode, city: data.alcaldia, line2: '' }))
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
          body: JSON.stringify(
            items?.length
              ? { items: items.map(i => i.productId), address }
              : { listingId, address },
          ),
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
  }, [needsShippingRate, addressReady, listingId, items, address])

  // ── Loading / error states ─────────────────────────────────────────────────
  if (optionsError) {
    return (
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>⚠ {optionsError}</p>
      </section>
    )
  }
  if (!options) {
    return (
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16, display: 'grid', gap: 8 }}>
        {[0, 1, 2].map(i => <div key={i} style={{ height: 54, borderRadius: 8, background: 'var(--bg-sunk)', opacity: 0.7 }} />)}
      </section>
    )
  }

  return (
    <>
      {/* ── Delivery not configured (no coord fallback) ────────────────────── */}
      {deliveryMethods.length === 0 && (
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>📦</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Este vendedor aún no configura la entrega</p>
              <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                Todavía no hay una opción de envío o recolección disponible para este artículo. Vuelve más tarde o escríbele al vendedor.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ── Delivery section ───────────────────────────────────────────────── */}
      {deliveryMethods.length > 0 && (
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Elige entrega</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {deliveryMethods.map(option => (
              <button key={option.id} type="button" onClick={() => setSelectedDeliveryId(option.id)} style={optionButtonStyle(selectedDelivery?.id === option.id)}>
                <span aria-hidden style={radioDot(selectedDelivery?.id === option.id)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{option.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Pickup spot picker — deterministic list of where you can recoger */}
          {selectedDelivery?.id === 'local_pickup' && (selectedDelivery.pickup_spots?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-muted)' }}>¿Dónde quieres recogerlo?</p>
              {selectedDelivery.pickup_spots!.map(spot => {
                const active = selectedPickupSpotId === spot.id
                return (
                  <button key={spot.id} type="button" onClick={() => setSelectedPickupSpotId(spot.id)} style={optionButtonStyle(active)}>
                    <span aria-hidden style={radioDot(active)} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{spot.name ?? 'Punto de entrega'}</span>
                      {spot.address && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{spot.address}</span>}
                      {spot.hours && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2 }}>🕐 {spot.hours}</span>}
                      {spot.notes && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2 }}>{spot.notes}</span>}
                      {spot.scheduling_url && active && (
                        <a href={spot.scheduling_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>
                          Agendar horario →
                        </a>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Address form (shipping) */}
          {selectedDelivery?.requires_address && (
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input value={address.name ?? ''} onChange={e => setAddress({ ...address, name: e.target.value })} placeholder="Nombre de quien recibe" style={inputStyle} />
                <input value={address.phone ?? ''} onChange={e => setAddress({ ...address, phone: e.target.value })} placeholder="Teléfono" inputMode="tel" style={inputStyle} />
              </div>

              <div>
                <div style={{ position: 'relative' }}>
                  <input
                    value={address.postal_code ?? ''}
                    onChange={e => handleCpChange(e.target.value)}
                    placeholder="Código postal (CP)"
                    inputMode="numeric"
                    maxLength={5}
                    style={{ ...inputStyle, paddingRight: 34, border: `1px solid ${cpLookupError ? 'var(--danger)' : cpResolved ? 'var(--success)' : 'var(--border)'}` }}
                  />
                  {cpLookupLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--fg-subtle)' }}>·</span>}
                  {cpResolved && !cpLookupLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--success)' }}>✓</span>}
                </div>
                {cpLookupError && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{cpLookupError}</p>}
                {!cpResolved && !cpLookupError && !address.postal_code?.length && (
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>Empieza con tu código postal — llenamos estado, alcaldía y colonias.</p>
                )}
              </div>

              {cpResolved && cpResult && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 3 }}>Estado</p>
                      <div style={{ ...inputStyle, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--success)' }}>✓</span>
                        <span style={{ fontSize: 13 }}>{cpResult.stateName}</span>
                      </div>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 3 }}>Alcaldía / Municipio</p>
                      <div style={{ ...inputStyle, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--success)' }}>✓</span>
                        <span style={{ fontSize: 13 }}>{cpResult.alcaldia}</span>
                      </div>
                    </div>
                  </div>

                  {cpResult.colonias.length > 0 && (
                    <select value={address.line2 ?? ''} onChange={e => setAddress({ ...address, line2: e.target.value })} style={inputStyle as CSSProperties}>
                      <option value="">Selecciona colonia</option>
                      {cpResult.colonias.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </>
              )}

              {cpResolved && (
                <>
                  <input value={address.line1 ?? ''} onChange={e => setAddress({ ...address, line1: e.target.value })} placeholder="Calle" style={inputStyle} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <input value={address.ext_number ?? ''} onChange={e => setAddress({ ...address, ext_number: e.target.value })} placeholder="No. exterior" style={inputStyle} />
                    <input value={address.int_number ?? ''} onChange={e => setAddress({ ...address, int_number: e.target.value })} placeholder="No. interior (opcional)" style={inputStyle} />
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
                      {[0, 1].map(i => <div key={i} style={{ height: 58, borderRadius: 8, background: 'var(--bg-sunk)', border: '1px solid var(--border)', opacity: 0.75 }} />)}
                    </div>
                  )}

                  {shippingRatesError && !shippingRatesLoading && (
                    <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 10 }}>
                      <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>{shippingRatesError}</p>
                      <p style={{ fontSize: 11, color: 'var(--fg-muted)' }}>También puedes coordinar la entrega directamente con el vendedor.</p>
                    </div>
                  )}

                  {shippingRatesMessage && !shippingRatesLoading && shippingRates.length === 0 && !shippingRatesError && (
                    <div style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 8, padding: 10 }}>
                      <p style={{ fontSize: 12, color: 'var(--warning)' }}>{shippingRatesMessage}</p>
                    </div>
                  )}

                  {shippingRates.map(rate => {
                    const active = selectedShippingRateId === rate.id
                    return (
                      <button key={rate.id} type="button" onClick={() => setSelectedShippingRateId(rate.id)} style={optionButtonStyle(active)}>
                        <span aria-hidden style={radioDot(active)} />
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

          {options.preparation && (
            <p style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 10 }}>📦 Tiempo de preparación: {options.preparation}</p>
          )}
        </section>
      )}

      {/* ── Payment section ────────────────────────────────────────────────── */}
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Elige pago</h2>

        {paymentMethods.length === 0 ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>🤝</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                {options.only_coordinated ? 'Este vendedor coordina pago y entrega juntos' : 'Pagos en línea no disponibles'}
              </p>
              <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                Escríbele directamente al vendedor para acordar el método de pago y la entrega antes de cerrar la venta.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {paymentMethods.map(option => {
              const active = selectedPayment?.id === option.id
              return (
                <div key={option.id}>
                  <button type="button" onClick={() => setSelectedPaymentId(option.id)} style={optionButtonStyle(active)}>
                    <span aria-hidden style={radioDot(active)} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800 }}>{option.label}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                          background: option.protected ? 'var(--success-soft)' : 'var(--bg-sunk)',
                          color: option.protected ? 'var(--success-strong)' : 'var(--fg-muted)',
                          border: `1px solid ${option.protected ? 'var(--success)' : 'var(--border)'}`,
                        }}>
                          {option.protected ? 'Protegido por Miyagi' : 'Acuerdo directo'}
                        </span>
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</span>
                    </span>
                  </button>

                  {/* Manual — preview the accepted methods + how each works so the
                      buyer doesn't commit blind. The exact account numbers (CLABE,
                      phone) appear on the order page right after placing. */}
                  {active && option.kind === 'manual' && manualMethods.length > 0 && (
                    <div style={{ marginTop: 6, marginLeft: 14, paddingLeft: 12, borderLeft: '2px solid var(--border)', display: 'grid', gap: 8 }}>
                      {manualMethods.map(m => (
                        <div key={m.type} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span aria-hidden style={{ fontSize: 14, lineHeight: 1.4 }}>
                            {m.type === 'clabe' ? '🏦' : m.type === 'dimo' ? '📱' : '💵'}
                          </span>
                          <span style={{ display: 'block' }}>
                            <strong style={{ fontSize: 12.5, color: 'var(--fg)' }}>{m.label}</strong>
                            {m.note && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5, marginTop: 1 }}>{m.note}</span>}
                          </span>
                        </div>
                      ))}
                      <p style={{ fontSize: 11.5, color: 'var(--fg-subtle)', lineHeight: 1.5 }}>
                        Verás los datos exactos para pagar (CLABE, teléfono) en tu pedido, justo después de confirmarlo.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Summary section ────────────────────────────────────────────────── */}
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Resumen</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>{items?.length ? `Artículos (${items.length})` : 'Producto'}</span>
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

          {/* ── Personalization echo (AC 3.1 — final review step) ─────────── */}
          {(() => {
            const blocks: Array<{ title?: string; lines: string[] }> = []
            const single = formatPersonalizationLines(personalization)
            if (single.length) blocks.push({ lines: single })
            for (const it of items ?? []) {
              const lines = formatPersonalizationLines(it.personalization)
              if (lines.length) blocks.push({ title: it.title, lines })
            }
            if (!blocks.length) return null
            return (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="iconoir-edit-pencil" style={{ fontSize: 13, color: 'var(--accent)' }} />
                  Personalización
                </p>
                {blocks.map((b, bi) => (
                  <div key={bi} style={{ marginBottom: bi < blocks.length - 1 ? 6 : 0 }}>
                    {b.title && <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{b.title}</p>}
                    {b.lines.map((line, i) => (
                      <p key={i} style={{ fontSize: 12, color: 'var(--fg-muted)', wordBreak: 'break-word' }}>{line}</p>
                    ))}
                  </div>
                ))}
              </div>
            )
          })()}

          {/* ── Coupon code ─────────────────────────────────────────────── */}
          {couponsAllowed && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
              {appliedCoupon ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, gap: 12 }}>
                  <span style={{ color: 'var(--fg-muted)' }}>
                    Cupón <strong style={{ color: 'var(--fg)', fontFamily: 'monospace' }}>{appliedCoupon.code}</strong>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <strong style={{ color: 'var(--success-ink)' }}>−{formatCents(couponDiscountCents, currency)}</strong>
                    <button type="button" onClick={removeCoupon} style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                      Quitar
                    </button>
                  </span>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={couponInput}
                      onChange={e => { setCouponInput(e.target.value.toUpperCase()); if (couponError) setCouponError(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon() } }}
                      placeholder="Código de descuento"
                      maxLength={24}
                      style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', letterSpacing: '0.04em' }}
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={couponValidating || !couponInput.trim()}
                      style={{ padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: couponValidating || !couponInput.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}
                    >
                      {couponValidating ? '…' : 'Aplicar'}
                    </button>
                  </div>
                  {couponError && <p style={{ fontSize: 12, color: 'var(--danger-strong)', marginTop: 6 }}>{couponError}</p>}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
            <span style={{ fontWeight: 800 }}>Total</span>
            <strong>{formatCents(totalCents, currency)}</strong>
          </div>
        </div>

        {selectedPayment ? (
          <CheckoutPayButton
            provider={selectedPayment.id}
            listingId={listingId}
            personalization={personalization}
            items={items}
            sellerId={sellerId}
            amountCents={amountCents}
            currency={currency}
            offerId={offerId}
            offerAmountCents={offerAmountCents}
            couponCode={appliedCoupon?.code}
            couponDiscountCents={couponDiscountCents}
            fulfillmentMethod={selectedDelivery?.id ?? 'none'}
            pickupSpotId={selectedPickupSpotId ?? undefined}
            shippingAddress={selectedDelivery?.requires_address ? address : undefined}
            shippingQuote={needsShippingRate ? selectedShippingQuote : undefined}
            originDomain={originDomain}
            disabled={!canPay}
            onStarted={onStarted}
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
