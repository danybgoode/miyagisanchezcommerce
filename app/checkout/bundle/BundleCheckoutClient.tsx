'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'
import { useCart } from '@/app/components/CartContext'
import CheckoutPayButton from '@/app/components/CheckoutPayButton'
import SpeiPaymentButton from '@/app/components/SpeiPaymentButton'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShippingRate {
  id: string
  rateId: string
  carrier: string
  service: string
  amountCents: number
  currency: string
  deliveryEstimate: number | null
  deliveryLabel: string | null
}

interface ShippingAddress {
  name: string
  phone?: string
  line1: string
  line2?: string
  city: string
  state: string
  postal_code: string
  country: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(cents / 100)
}

const MX_STATES = [
  'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua',
  'Ciudad de México','Coahuila','Colima','Durango','Estado de México','Guanajuato','Guerrero',
  'Hidalgo','Jalisco','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro',
  'Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala',
  'Veracruz','Yucatán','Zacatecas',
]

// ── Address form ──────────────────────────────────────────────────────────────

function AddressForm({
  value,
  onChange,
  onGetRates,
  loadingRates,
  error,
}: {
  value: Partial<ShippingAddress>
  onChange: (v: Partial<ShippingAddress>) => void
  onGetRates: () => void
  loadingRates: boolean
  error: string | null
}) {
  const set = (k: keyof ShippingAddress) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value })

  const ready = !!(value.name?.trim() && value.line1?.trim() && value.city?.trim() && value.state?.trim() && value.postal_code?.trim())

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Nombre completo</label>
          <input value={value.name ?? ''} onChange={set('name')} placeholder="Nombre del destinatario"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Dirección (calle y número)</label>
          <input value={value.line1 ?? ''} onChange={set('line1')} placeholder="Calle Reforma 123"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Colonia / Delegación (opcional)</label>
          <input value={value.line2 ?? ''} onChange={set('line2')} placeholder="Col. Centro"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Ciudad / Municipio</label>
          <input value={value.city ?? ''} onChange={set('city')} placeholder="Ciudad de México"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Código postal</label>
          <input value={value.postal_code ?? ''} onChange={set('postal_code')} placeholder="06600" maxLength={5}
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Estado</label>
          <select value={value.state ?? ''} onChange={set('state')}
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-white">
            <option value="">Selecciona un estado…</option>
            {MX_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">Teléfono (opcional)</label>
          <input value={value.phone ?? ''} onChange={set('phone')} placeholder="55 1234 5678" type="tel"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30" />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">⚠ {error}</p>}
      <button type="button" onClick={onGetRates} disabled={!ready || loadingRates}
        className="w-full bg-[var(--accent)] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors">
        {loadingRates ? 'Cotizando…' : 'Ver opciones de envío →'}
      </button>
    </div>
  )
}

// ── Rate picker ───────────────────────────────────────────────────────────────

function RatePicker({
  rates,
  selected,
  onSelect,
  onClear,
  currency,
}: {
  rates: ShippingRate[]
  selected: ShippingRate | null
  onSelect: (r: ShippingRate) => void
  onClear: () => void
  currency: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wide">Opciones de envío</p>
        <button type="button" onClick={onClear} className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">Cambiar dirección</button>
      </div>
      <div className="space-y-2">
        {rates.map(rate => (
          <button key={rate.id} type="button" onClick={() => onSelect(rate)}
            className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
              selected?.id === rate.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border)] hover:border-[var(--accent)]/50'
            }`}>
            <div className="flex-1">
              <p className="font-semibold text-sm">{rate.carrier.toUpperCase()} · {rate.service}</p>
              {rate.deliveryLabel && <p className="text-xs text-[var(--fg-muted)] mt-0.5">{rate.deliveryLabel}</p>}
            </div>
            <span className="font-bold text-sm text-[var(--accent)]">{fmt(rate.amountCents, currency)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BundleCheckoutClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const requestedSellerId = searchParams.get('sellerId')
  const { isSignedIn, user } = useUser()
  const { getToken } = useAuth()
  const { itemsBySeller, removeItem, clearSeller } = useCart()

  const sellerIds = Array.from(itemsBySeller.keys())
  const sellerId = requestedSellerId && itemsBySeller.has(requestedSellerId)
    ? requestedSellerId
    : sellerIds[0]
  const items = sellerId ? (itemsBySeller.get(sellerId) ?? []) : []
  const seller = items[0]
  const subtotal = items.reduce((sum, item) => sum + item.price_cents, 0)
  const currency = seller?.currency ?? 'MXN'
  const returnPath = `/checkout/bundle${sellerId ? `?sellerId=${encodeURIComponent(sellerId)}` : ''}`
  const currencyMismatch = items.some(item => item.currency !== currency)
  const hasMp = items.length > 0 && items.every(item => item.paymentMethods.mp)
  const hasStripe = items.length > 0 && items.every(item => item.paymentMethods.stripe)
  // SPEI: stored in CartItem metadata — check seller CLABE availability
  const hasSpei = items.length > 0 && !!(items[0] as any).paymentMethods?.spei

  // ── Shipping state ──────────────────────────────────────────────────────────
  const hasPhysical = items.some(i => i.listing_type === 'product')
  const [address, setAddress] = useState<Partial<ShippingAddress>>({
    name: user?.fullName ?? '',
    country: 'MX',
  })
  const [addressStep, setAddressStep] = useState<'form' | 'rates' | 'selected'>('form')
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([])
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null)
  const [loadingRates, setLoadingRates] = useState(false)
  const [ratesError, setRatesError] = useState<string | null>(null)

  // ── Bundle discount display (fetched after startCheckout returns; display from client calc) ─
  // We mirror the server-side tier logic here for UX only — server is authoritative
  const [bundleDiscount, setBundleDiscount] = useState<{ percent_off: number; discount_cents: number } | null>(null)

  const shippingCents = selectedRate?.amountCents ?? 0
  const displayTotal = subtotal + shippingCents

  const getShippingRates = useCallback(async () => {
    setLoadingRates(true)
    setRatesError(null)
    try {
      const res = await fetch('/api/checkout/shipping-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(i => i.productId),
          address: {
            name: address.name,
            phone: address.phone,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            state: address.state,
            postal_code: address.postal_code,
            country: address.country ?? 'MX',
          },
        }),
      })
      const data = await res.json() as { rates?: ShippingRate[]; error?: string }
      if (!res.ok) { setRatesError(data.error ?? 'Error al cotizar.'); return }
      const rates = data.rates ?? []
      setShippingRates(rates)
      setSelectedRate(rates[0] ?? null)
      setAddressStep('rates')
    } catch {
      setRatesError('Sin conexión. Intenta de nuevo.')
    } finally {
      setLoadingRates(false)
    }
  }, [items, address])

  const shippingQuote = selectedRate
    ? {
        rateId: selectedRate.rateId,
        carrier: selectedRate.carrier,
        service: selectedRate.service,
        amountCents: selectedRate.amountCents,
        currency: selectedRate.currency,
        deliveryEstimate: selectedRate.deliveryEstimate,
        deliveryLabel: selectedRate.deliveryLabel,
      }
    : undefined

  const needsShipping = hasPhysical && items.some(i => i.listing_type === 'product')
  const canProceedToPayment = !needsShipping || !!selectedRate

  if (!isSignedIn) {
    return (
      <main className="max-w-[640px] mx-auto px-4 py-8">
        <Link href="/l" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>← Explorar</Link>
        <section style={{ marginTop: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Inicia sesión para comprar tu paquete</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6 }}>Guardamos tu selección y te regresamos aquí para revisar antes de pagar.</p>
          <Link href={`/sign-in?redirect_url=${encodeURIComponent(returnPath)}`} className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>
            Iniciar sesión
          </Link>
        </section>
      </main>
    )
  }

  if (items.length === 0) {
    return (
      <main className="max-w-[640px] mx-auto px-4 py-8">
        <Link href="/l" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>← Explorar</Link>
        <section style={{ marginTop: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Tu paquete está vacío</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6 }}>Agrega artículos de una misma tienda para revisar el paquete.</p>
          <Link href="/l" className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>Ver anuncios</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="max-w-[760px] mx-auto px-4 py-5 md:py-8">
      <div style={{ marginBottom: 18 }}>
        <Link href={`/s/${seller.sellerSlug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>
          <i className="iconoir-arrow-left" style={{ fontSize: 16 }} />
          Volver a la tienda
        </Link>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Multi-seller switcher */}
        {sellerIds.length > 1 && (
          <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>Tienes paquetes de varias tiendas. Elige uno para pagar.</p>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {sellerIds.map(id => {
                const group = itemsBySeller.get(id) ?? []
                const active = id === sellerId
                const total = group.reduce((sum, item) => sum + item.price_cents, 0)
                return (
                  <Link key={id} href={`/checkout/bundle?sellerId=${encodeURIComponent(id)}`} className="no-underline"
                    style={{ flexShrink: 0, minWidth: 160, padding: 10, borderRadius: 'var(--r-md)',
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-soft)' : 'var(--bg-sunk)', color: 'var(--fg)' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group[0]?.sellerName ?? 'Tienda'}</p>
                    <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{group.length} artículo{group.length === 1 ? '' : 's'} · {fmt(total, group[0]?.currency ?? 'MXN')}</p>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Item list */}
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>Paquete de {seller.sellerName}</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>Revisar paquete</h1>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>Compra varios artículos del mismo vendedor en un solo pago.</p>
          </div>

          <div style={{ display: 'grid' }}>
            {items.map(item => (
              <div key={item.productId} style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid var(--border)' }}>
                <Link href={`/l/${item.productId}`} style={{ width: 68, height: 68, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-sunk)', flexShrink: 0 }}>
                  {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{item.title}</p>
                  <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>{fmt(item.price_cents, item.currency)}</p>
                </div>
                <button type="button" onClick={() => removeItem(item.productId)} aria-label="Quitar del paquete"
                  style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--bg-sunk)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="iconoir-xmark" style={{ fontSize: 15 }} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Shipping section — physical items only */}
        {needsShipping && (
          <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Dirección de entrega</h2>
            {addressStep === 'form' && (
              <AddressForm
                value={address}
                onChange={setAddress}
                onGetRates={getShippingRates}
                loadingRates={loadingRates}
                error={ratesError}
              />
            )}
            {(addressStep === 'rates' || addressStep === 'selected') && (
              <RatePicker
                rates={shippingRates}
                selected={selectedRate}
                onSelect={r => { setSelectedRate(r); setAddressStep('selected') }}
                onClear={() => { setAddressStep('form'); setSelectedRate(null); setShippingRates([]) }}
                currency={currency}
              />
            )}
          </section>
        )}

        {/* Order summary + payment */}
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Resumen</h2>
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Artículos ({items.length})</span>
              <strong>{fmt(subtotal, currency)}</strong>
            </div>
            {bundleDiscount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--success)' }}>Descuento paquete (−{bundleDiscount.percent_off}%)</span>
                <strong style={{ color: 'var(--success)' }}>−{fmt(bundleDiscount.discount_cents, currency)}</strong>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Envío</span>
              <strong>{selectedRate ? fmt(shippingCents, currency) : needsShipping ? 'Selecciona dirección' : 'Se coordina con vendedor'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Comisión Miyagi</span>
              <strong>$0</strong>
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800 }}>
              <span>Total estimado</span>
              <span>{fmt(displayTotal - (bundleDiscount?.discount_cents ?? 0), currency)}</span>
            </div>
            {!canProceedToPayment && needsShipping && (
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
                Completa la dirección de entrega para continuar con el pago.
              </p>
            )}
          </div>

          {canProceedToPayment && (
            <div style={{ display: 'grid', gap: 10 }}>
              {currencyMismatch && (
                <p style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-md)', padding: 10 }}>
                  Este paquete mezcla monedas. Quita artículos hasta que todos tengan la misma moneda.
                </p>
              )}

              {!currencyMismatch && (
                <>
                  {hasMp && sellerId && (
                    <CheckoutPayButton
                      provider="mercadopago"
                      items={items}
                      sellerId={sellerId}
                      amountCents={subtotal}
                      currency={currency}
                      shippingQuote={shippingQuote}
                      onStarted={() => clearSeller(sellerId)}
                    />
                  )}
                  {hasStripe && sellerId && (
                    <CheckoutPayButton
                      provider="stripe"
                      items={items}
                      sellerId={sellerId}
                      amountCents={subtotal}
                      currency={currency}
                      shippingQuote={shippingQuote}
                      onStarted={() => clearSeller(sellerId)}
                    />
                  )}
                  {hasSpei && sellerId && (
                    <SpeiPaymentButton
                      listingId={items[0]?.productId ?? ''}
                      sellerId={sellerId}
                      amountCents={subtotal}
                      currency={currency}
                      isSignedIn={isSignedIn ?? false}
                    />
                  )}
                  {!hasMp && !hasStripe && !hasSpei && (
                    <p style={{ fontSize: 13, color: 'var(--fg-muted)', textAlign: 'center' }}>
                      Este vendedor todavía no tiene pagos en línea activos.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
