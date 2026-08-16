'use client'

/* eslint-disable @next/next/no-img-element -- listing thumbnails may be seller-hosted on arbitrary remote domains. */

import { BuyerCopyText, useBuyerCopy, useBuyerFormatters } from '@/app/components/BuyerPresentationContext'
import Link from 'next/link'
import { useCart, type CartItem } from '@/app/components/CartContext'

/**
 * Listing card for the seller closet (/s/[slug]).
 * Primary action: navigate to listing (Link wrapping the image/title).
 * Secondary action: add/remove from bundle cart (shown only for physical products with a price).
 */
export default function ClosetListingCard({
  item,
  accent,
}: {
  item: CartItem & { href: string; imageUrl: string | null; formattedPrice?: string; status?: string; hasExcerpt?: boolean }
  accent: string
}) {
  const copy = useBuyerCopy()
  const formatters = useBuyerFormatters()
  const { addItem, removeItem, items: cartItems } = useCart()
  const inCart = cartItems.some(ci => ci.productId === item.productId)
  const showCartButton = item.listing_type === 'product' && item.price_cents > 0

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden transition-all hover:shadow-md relative group">
      <Link href={item.href} className="no-underline block">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.title} className="w-full h-36 object-cover" />
        ) : (
          <div className="w-full h-36 bg-[var(--color-surface-alt)] flex items-center justify-center text-3xl"><i className="iconoir-package" aria-hidden /></div>
        )}
        <div className="p-2.5 pb-1">
          <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2 leading-snug">{item.title}</p>
          {item.hasExcerpt && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <i className="iconoir-book" aria-hidden /> <BuyerCopyText copyKey="s.slug.ClosetListingCard.3def2049" /></span>
          )}
          <p className="text-sm font-bold mt-1" style={{ color: accent }}>
            {item.formattedPrice ?? formatters.currency(item.price_cents, item.currency, { maximumFractionDigits: 0 })}
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
            aria-label={inCart ? copy('s.slug.ClosetListingCard.b9f3829e') : copy('s.slug.ClosetListingCard.6a22e5f0')}
          >
            {inCart ? <><i className="iconoir-check" aria-hidden /> <BuyerCopyText copyKey="s.slug.ClosetListingCard.ee7138da" /></> : <BuyerCopyText copyKey="s.slug.ClosetListingCard.ce395d34" />}
          </button>
        </div>
      )}
    </div>
  )
}
