/* eslint-disable @next/next/no-img-element -- banner and product art are seller-hosted on R2. */

import Link from 'next/link'
import { heroContent } from '@/lib/shop-presentation/chrome'
import type { Shop } from '@/lib/types'
import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the hero (epic 07, Story 8.2).
 *
 * The concept's top-of-shop: eyebrow, a display headline, a lead, two actions,
 * and an art panel with a poster card and stickers.
 *
 * WHAT IT REFUSES TO INVENT. The mockup's copy is written for a fictional shop.
 * A real one may have no tagline and no description, and a hero that restated
 * the shop's own name in 68px over an empty frame would be worse than no hero —
 * so `heroContent().substantial` gates the whole block, and the art panel only
 * appears when there is a real image (banner, else newest product) to put in it.
 * The stickers are decorative and marked `aria-hidden`.
 */

export default function ShopHero({
  shop,
  tagline,
  bannerUrl,
  artUrl,
  posterTitle,
  shopHref,
  wallHref,
  accent,
  accentTextColor,
  copy,
}: {
  shop: Pick<Shop, 'name' | 'description' | 'location'>
  tagline: string | null
  bannerUrl: string | null
  /** Newest product image — the art fallback when there is no banner. */
  artUrl: string | null
  /** The newest collection or product name, for the poster card. */
  posterTitle: string | null
  shopHref: string
  wallHref: string
  accent: string
  accentTextColor: string
  copy: Dictionary['buyerCopy']
}) {
  const content = heroContent(shop, tagline)
  if (!content.substantial) return null

  const art = bannerUrl ?? artUrl

  return (
    <section className="shop-hero">
      <div className="shop-hero-copy">
        {content.eyebrow && <p className="shop-eyebrow" style={{ color: accent }}>{content.eyebrow}</p>}
        <h1 className="shop-hero-title">{content.headline}</h1>
        {content.lead && <p className="shop-hero-lead">{content.lead}</p>}
        <div className="shop-hero-actions">
          <Link href={shopHref} className="shop-cta-primary" style={{ background: accent, color: accentTextColor }}>
            {copy['shopChrome.heroShop']}
          </Link>
          <Link href={wallHref} className="shop-cta-secondary">{copy['shopChrome.heroWall']}</Link>
        </div>
      </div>

      {art && (
        <div className="shop-hero-art">
          <img src={art} alt="" className="shop-hero-art-img" />
          {posterTitle && (
            <div className="shop-poster">
              <small>{copy['shopChrome.newDrop']}</small>
              <b>{posterTitle}</b>
            </div>
          )}
          {/* Decorative only — they carry no information a screen reader needs. */}
          <span className="shop-sticker shop-sticker-1" aria-hidden style={{ background: accent, color: accentTextColor }}>
            {copy['shopChrome.newBadge']}
          </span>
        </div>
      )}
    </section>
  )
}
