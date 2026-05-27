'use client'

import { useCart } from './CartContext'
import type { CartItem } from './CartContext'

export default function AddToCartButton({ item }: { item: CartItem }) {
  const { addItem, openCart, items } = useCart()
  const inCart = items.some(i => i.productId === item.productId)

  return (
    <button
      type="button"
      onClick={() => inCart ? openCart() : addItem(item)}
      style={{
        width: '100%',
        padding: '12px 16px',
        borderRadius: 'var(--r-pill)',
        border: `2px solid ${inCart ? 'transparent' : 'var(--border)'}`,
        background: inCart ? 'var(--accent-soft)' : 'var(--bg)',
        color: inCart ? 'var(--accent)' : 'var(--fg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 14, fontWeight: 600,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
      }}
    >
      <i
        className={inCart ? 'iconoir-check' : 'iconoir-bag-plus'}
        style={{ fontSize: 16 }}
      />
      {inCart ? 'En carrito — Ver' : 'Agregar al carrito'}
    </button>
  )
}
