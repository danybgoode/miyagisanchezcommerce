'use client'

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import CheckoutPayButton from '@/app/components/CheckoutPayButton'
import type { CheckoutFulfillmentMethod, CheckoutProvider, CheckoutShippingAddress } from '@/lib/cart'

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
  const canPay = Boolean(selectedDelivery && selectedPayment && addressReady)

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
            <span style={{ color: 'var(--fg-muted)' }}>Entrega</span>
            <strong>{selectedDelivery?.label ?? 'Por coordinar'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Pago</span>
            <strong>{selectedPayment?.label ?? 'No disponible'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Comisión Miyagi</span>
            <strong>$0</strong>
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
