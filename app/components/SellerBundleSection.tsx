'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart, type CartItem } from './CartContext'
import { readStashedPersonalization } from '@/lib/personalization'

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

interface BundleTier { min_items: number; percent_off: number }

function resolveTier(tiers: BundleTier[], count: number): BundleTier | null {
  if (!tiers.length || count < 2) return null
  const q = tiers.filter(t => t.min_items >= 2 && t.min_items <= count && t.percent_off > 0).sort((a, b) => b.min_items - a.min_items)
  return q[0] ?? null
}

export default function SellerBundleSection({
  sellerName,
  items,
  bundleTiers = [],
}: {
  sellerName: string
  items: CartItem[]
  bundleTiers?: BundleTier[]
}) {
  const router = useRouter()
  const { addItem, removeItem, closeCart, items: cartItems } = useCart()
  const selected = items.filter(item => cartItems.some(cartItem => cartItem.productId === item.productId))
  const subtotal = selected.reduce((sum, item) => sum + item.price_cents, 0)
  const checkoutSellerId = selected[0]?.sellerId ?? items[0]?.sellerId
  if (items.length < 2) return null

  const activeTier = resolveTier(bundleTiers, selected.length)
  const discountCents = activeTier ? Math.round(subtotal * activeTier.percent_off / 100) : 0
  const discountedSubtotal = subtotal - discountCents

  function toggleItem(item: CartItem, inBundle: boolean) {
    if (inBundle) {
      removeItem(item.productId)
      return
    }
    // Carry personalization the buyer entered in this product's buy box (stashed
    // by PersonalizationBuyBox) into the cart line so it echoes + reaches the order.
    const personalization = readStashedPersonalization(item.productId)
    addItem(personalization ? { ...item, personalization } : item)
    closeCart()
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: 16 }}>Arma un paquete</h2>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Combina artículos de {sellerName} y revisa todo antes de pagar.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/checkout/bundle?sellerId=${checkoutSellerId}`)}
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
                onClick={() => toggleItem(item, inBundle)}
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
                {inBundle ? 'Quitar del paquete' : 'Agregar al paquete'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Next tier teaser — shown when no tier active yet */}
      {selected.length > 0 && !activeTier && bundleTiers.length > 0 && (() => {
        const nextTier = bundleTiers.filter(t => t.min_items > selected.length && t.percent_off > 0).sort((a, b) => a.min_items - b.min_items)[0]
        if (!nextTier) return null
        return (
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
            Agrega {nextTier.min_items - selected.length} artículo{nextTier.min_items - selected.length > 1 ? 's' : ''} más y obtén{' '}
            <strong style={{ color: 'var(--success)' }}>{nextTier.percent_off}% de descuento</strong>
          </p>
        )
      })()}

      {selected.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{selected.length} {selected.length === 1 ? 'artículo' : 'artículos'} en paquete</p>
            {activeTier ? (
              <>
                <p style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--fg-muted)', margin: 0 }}>{formatPrice(subtotal, selected[0].currency)}</p>
                <p style={{ fontSize: 17, fontWeight: 800, color: 'var(--success)' }}>{formatPrice(discountedSubtotal, selected[0].currency)}</p>
                <p style={{ fontSize: 11, color: 'var(--success)' }}>🎉 {activeTier.percent_off}% de descuento aplicado</p>
              </>
            ) : (
              <p style={{ fontSize: 17, fontWeight: 800 }}>{formatPrice(subtotal, selected[0].currency)}</p>
            )}
          </div>
          <button type="button" onClick={() => router.push(`/checkout/bundle?sellerId=${checkoutSellerId}`)} className="font-semibold rounded-xl text-sm" style={{ padding: '10px 14px', background: 'var(--fg)', color: 'var(--fg-inverse)', border: 'none' }}>
            Comprar paquete
          </button>
        </div>
      )}
    </section>
  )
}
