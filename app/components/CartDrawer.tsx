'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useCart, type CartItem } from './CartContext'

const SPRING   = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

// ── Seller group ──────────────────────────────────────────────────────────────

function SellerGroup({ sellerId, items }: { sellerId: string; items: CartItem[] }) {
  const { removeItem, closeCart } = useCart()

  const seller = items[0]
  const subtotal = items.reduce((s, i) => s + i.price_cents, 0)
  const currency = items[0].currency
  const hasStripe = items.every(i => i.paymentMethods.stripe)
  const hasMp = items.every(i => i.paymentMethods.mp)

  return (
    <div style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
      {/* Seller header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 12, flexShrink: 0,
        }}>
          {seller.sellerName.charAt(0).toUpperCase()}
        </div>
        <Link
          href={`/s/${seller.sellerSlug}`}
          onClick={closeCart}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', textDecoration: 'none' }}
          className="hover:text-[var(--accent)]"
        >
          {seller.sellerName}
        </Link>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 'auto' }}>
          {items.length} {items.length === 1 ? 'artículo' : 'artículos'}
        </span>
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {items.map(item => (
          <div
            key={item.productId}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 20px',
            }}
          >
            {/* Thumbnail */}
            <div style={{
              width: 52, height: 52, borderRadius: 8, overflow: 'hidden',
              background: 'var(--bg-sunk)', flexShrink: 0,
              border: '1px solid var(--border)',
            }}>
              {item.imageUrl
                ? <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="iconoir-package" style={{ fontSize: 20, color: 'var(--fg-subtle)' }} />
                  </div>
              }
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 13, fontWeight: 500, color: 'var(--fg)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                margin: 0,
              }}>
                {item.title}
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)', margin: '2px 0 0' }}>
                {formatPrice(item.price_cents, item.currency)}
              </p>
            </div>

            {/* Remove */}
            <button
              type="button"
              onClick={() => removeItem(item.productId)}
              title="Quitar"
              style={{
                width: 28, height: 28, borderRadius: '50%', border: 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--fg-muted)', flexShrink: 0,
                transition: 'background 150ms ease, color 150ms ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-sunk)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)' }}
            >
              <i className="iconoir-xmark" style={{ fontSize: 14 }} />
            </button>
          </div>
        ))}
      </div>

      {/* Subtotal + checkout */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            Subtotal{items.length > 1 ? ` (${items.length} artículos)` : ''}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>
            {formatPrice(subtotal, currency)}
          </span>
        </div>

        {/* Checkout CTAs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(hasMp || hasStripe) && (
            <Link
              href={`/checkout/bundle?sellerId=${sellerId}`}
              onClick={closeCart}
              style={{
                width: '100%', padding: '11px 16px', borderRadius: 12,
                border: 'none',
                background: '#009ee3',
                color: '#fff', fontFamily: 'var(--font-sans)',
                fontSize: 14, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                textDecoration: 'none',
              }}
            >
              Revisar paquete
            </Link>
          )}
          {!hasStripe && !hasMp && (
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
              Este vendedor no tiene pagos en línea activos.
            </p>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyCart({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'var(--bg-sunk)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }}>
        <i className="iconoir-shopping-bag" style={{ fontSize: 32, color: 'var(--fg-muted)' }} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', margin: '0 0 6px' }}>
        Tu carrito está vacío
      </p>
      <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: '0 0 24px', lineHeight: 1.5 }}>
        Agrega artículos desde cualquier listing para pagar todo en un solo paso.
      </p>
      <Link
        href="/l"
        onClick={onClose}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 14, fontWeight: 600,
          color: 'var(--accent)', textDecoration: 'none',
        }}
      >
        Explorar listings <i className="iconoir-arrow-right" style={{ fontSize: 14 }} />
      </Link>
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export default function CartDrawer() {
  const { isOpen, closeCart, items, itemsBySeller } = useCart()
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) closeCart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeCart])

  // Trap scroll on body when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Focus first interactive element when opened
  useEffect(() => {
    if (isOpen) {
      const btn = panelRef.current?.querySelector<HTMLElement>('button, a')
      btn?.focus()
    }
  }, [isOpen])

  const sellerIds = Array.from(itemsBySeller.keys())

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={closeCart}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(2px)',
          opacity: isOpen ? 1 : 0,
          transition: `opacity 250ms ${EASE_OUT}`,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de compra"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 201,
          width: '100%', maxWidth: 420,
          background: 'var(--bg)',
          display: 'flex', flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: isOpen
            ? `transform 380ms ${SPRING}`
            : `transform 260ms ${EASE_OUT}`,
          boxShadow: '-12px 0 40px rgba(0,0,0,0.12)',
          // Safe area for notched phones
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="iconoir-shopping-bag" style={{ fontSize: 18, color: 'var(--fg)' }} />
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--fg)' }}>
              Tu carrito
            </span>
            {items.length > 0 && (
              <span style={{
                fontSize: 12, fontWeight: 600, color: 'var(--accent)',
                background: 'var(--accent-soft)',
                borderRadius: 'var(--r-pill)', padding: '2px 7px',
              }}>
                {items.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeCart}
            aria-label="Cerrar carrito"
            style={{
              width: 32, height: 32, borderRadius: '50%', border: 'none',
              background: 'var(--bg-sunk)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--fg)',
            }}
          >
            <i className="iconoir-xmark" style={{ fontSize: 16 }} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {sellerIds.length === 0 ? (
            <EmptyCart onClose={closeCart} />
          ) : (
            sellerIds.map(sid => (
              <SellerGroup
                key={sid}
                sellerId={sid}
                items={itemsBySeller.get(sid)!}
              />
            ))
          )}
        </div>

        {/* Footer hint — multi-seller */}
        {sellerIds.length > 1 && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-sunk)',
            flexShrink: 0,
          }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
              Tienes artículos de {sellerIds.length} vendedores. Cada uno se paga por separado y llega en su propio envío.
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}
