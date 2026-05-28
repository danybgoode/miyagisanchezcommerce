'use client'

import Link from 'next/link'
import { useCart, type CartItem } from './CartContext'

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export default function SellerBundleSection({
  sellerName,
  items,
}: {
  sellerName: string
  items: CartItem[]
}) {
  const { addItem, removeItem, openCart, items: cartItems } = useCart()
  const selected = items.filter(item => cartItems.some(cartItem => cartItem.productId === item.productId))
  const subtotal = selected.reduce((sum, item) => sum + item.price_cents, 0)
  if (items.length < 2) return null

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: 16 }}>Arma un paquete</h2>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Combina artículos de {sellerName} y paga todo junto.</p>
        </div>
        <button
          type="button"
          onClick={openCart}
          disabled={selected.length === 0}
          className="font-semibold rounded-xl text-sm disabled:opacity-50"
          style={{ padding: '10px 14px', background: 'var(--accent)', color: '#fff', border: 'none', flexShrink: 0 }}
        >
          Revisar{selected.length ? ` (${selected.length})` : ''}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {items.map((item, index) => {
          const inBundle = cartItems.some(cartItem => cartItem.productId === item.productId)
          return (
            <div key={item.productId} style={{ minWidth: 0 }}>
              <Link href={`/l/${item.productId}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-sunk)', marginBottom: 7 }}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="iconoir-package" style={{ fontSize: 26, color: 'var(--fg-subtle)' }} />
                    </div>
                  )}
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {index === 0 ? 'Este artículo · ' : ''}{item.title}
                </p>
                <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>{formatPrice(item.price_cents, item.currency)}</p>
              </Link>
              <button
                type="button"
                onClick={() => inBundle ? removeItem(item.productId) : addItem(item)}
                className="font-semibold rounded-xl text-sm"
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '9px 12px',
                  background: inBundle ? 'var(--bg-elevated)' : 'transparent',
                  color: inBundle ? 'var(--danger)' : 'var(--accent)',
                  border: `1.5px solid ${inBundle ? 'var(--danger)' : 'var(--accent)'}`,
                }}
              >
                {inBundle ? 'Quitar' : 'Agregar'}
              </button>
            </div>
          )
        })}
      </div>

      {selected.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{selected.length} {selected.length === 1 ? 'artículo' : 'artículos'} en paquete</p>
            <p style={{ fontSize: 17, fontWeight: 800 }}>{formatPrice(subtotal, selected[0].currency)}</p>
          </div>
          <button type="button" onClick={openCart} className="font-semibold rounded-xl text-sm" style={{ padding: '10px 14px', background: 'var(--fg)', color: 'var(--fg-inverse)', border: 'none' }}>
            Comprar paquete
          </button>
        </div>
      )}
    </section>
  )
}
