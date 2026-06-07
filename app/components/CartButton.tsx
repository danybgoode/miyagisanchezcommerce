'use client'

import { useCart } from './CartContext'

export default function CartButton() {
  const { openCart, totalItems } = useCart()

  return (
    <button
      type="button"
      onClick={openCart}
      title="Ver carrito"
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--fg-muted)',
        borderRadius: '50%',
      }}
      className="hover:text-[var(--fg)]"
    >
      <i className="iconoir-shopping-bag" style={{ fontSize: 18, verticalAlign: 'middle' }} />
      {totalItems > 0 && (
        <span style={{
          position: 'absolute',
          top: 0, right: 0,
          transform: 'translate(4px, -4px)',
          minWidth: 16, height: 16,
          borderRadius: 'var(--r-pill)',
          background: 'var(--accent)',
          color: 'var(--fg-inverse)',
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px',
          lineHeight: 1,
          pointerEvents: 'none',
        }}>
          {totalItems > 9 ? '9+' : totalItems}
        </span>
      )}
    </button>
  )
}
