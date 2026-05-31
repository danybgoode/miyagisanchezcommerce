'use client'

import Link from 'next/link'
import { useCart, type CartItem } from '@/app/components/CartContext'

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(cents / 100)
}

/**
 * Listing card for the seller closet (/s/[slug]).
 * Primary action: navigate to listing (Link wrapping the image/title).
 * Secondary action: add/remove from bundle cart (shown only for physical products with a price).
 */
export default function ClosetListingCard({
  item,
  accent,
}: {
  item: CartItem & { href: string; imageUrl: string | null; formattedPrice?: string; status?: string }
  accent: string
}) {
  const { addItem, removeItem, items: cartItems } = useCart()
  const inCart = cartItems.some(ci => ci.productId === item.productId)
  const showCartButton = item.listing_type === 'product' && item.price_cents > 0

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden transition-all hover:shadow-md relative group">
      <Link href={item.href} className="no-underline block">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.title} className="w-full h-36 object-cover" />
        ) : (
          <div className="w-full h-36 bg-[var(--color-surface-alt)] flex items-center justify-center text-3xl">📦</div>
        )}
        <div className="p-2.5 pb-1">
          <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2 leading-snug">{item.title}</p>
          <p className="text-sm font-bold mt-1" style={{ color: accent }}>
            {item.formattedPrice ?? formatPrice(item.price_cents, item.currency)}
          </p>
        </div>
      </Link>

      {showCartButton && (
        <div className="px-2.5 pb-2.5">
          <button
            type="button"
            onClick={() => inCart ? removeItem(item.productId) : addItem(item)}
            className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors border ${
              inCart
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent)]/30 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                : 'bg-transparent text-[var(--color-accent)] border-[var(--color-accent)]/40 hover:bg-[var(--color-accent-soft)]'
            }`}
            aria-label={inCart ? 'Quitar del paquete' : 'Agregar al paquete'}
          >
            {inCart ? '✓ En paquete' : '+ Agregar al paquete'}
          </button>
        </div>
      )}
    </div>
  )
}
