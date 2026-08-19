/* eslint-disable @next/next/no-img-element -- seller logos are R2/remote, outside the Next Image allow-list. */

import Link from 'next/link'
import { navEntries } from '@/lib/shop-presentation/sections'
import { shopInitials } from '@/lib/shop-presentation/chrome'
import type { SectionConfig, SectionAvailability, SectionKey } from '@/lib/shop-presentation/types'
import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the shop header (epic 07, Story 8.1).
 *
 * Identity and navigation together, sticky, as the concept has it: a merchant's
 * name should travel with the links rather than scroll away above them.
 *
 * It REPLACES the bare chip strip the section nav shipped as. The section links
 * are the same ones, from the same derivation — `navEntries` — so a hidden or
 * empty section still cannot produce a dead link here.
 *
 * The cart is a link, not a live count: the buyer's bag is client state that the
 * marketplace shell already owns, and duplicating a counter here would be a
 * second source of truth for how many things you are buying.
 */

const LABEL_KEY: Record<SectionKey, keyof Dictionary['buyerCopy']> = {
  wall: 'shopNav.wall',
  shop: 'shopNav.shop',
  collections: 'shopNav.collections',
  events: 'shopNav.events',
  about: 'shopNav.about',
  faq: 'shopNav.faq',
  policies: 'shopNav.policies',
}

export default function ShopHeader({
  shopName,
  logoUrl,
  config,
  availability,
  basePath,
  active,
  accent,
  accentTextColor,
  cartHref,
  copy,
}: {
  shopName: string
  logoUrl: string | null
  config: SectionConfig
  availability: SectionAvailability
  basePath: string
  active: SectionKey | null
  accent: string
  accentTextColor: string
  cartHref: string
  copy: Dictionary['buyerCopy']
}) {
  const entries = navEntries(config, availability, basePath)

  return (
    <header className="shop-header">
      <div className="shop-header-inner">
        <Link href={basePath || '/'} className="shop-identity" aria-label={shopName}>
          {logoUrl ? (
            <img src={logoUrl} alt="" className="shop-avatar" />
          ) : (
            <span className="shop-avatar shop-avatar-fallback" style={{ background: accent, color: accentTextColor }}>
              {shopInitials(shopName)}
            </span>
          )}
          {/* Truncates rather than wraps: a long shop name must not push the
              links onto a second row and shove the bag off screen. */}
          <span className="shop-name">{shopName}</span>
        </Link>

        <nav aria-label={copy['shopNav.label']} className="shop-navlinks">
          {entries.map((entry) => (
            <Link
              key={entry.key}
              href={entry.path}
              aria-current={entry.key === active ? 'page' : undefined}
              className="shop-navlink"
              style={entry.key === active ? { background: accent, color: accentTextColor } : undefined}
            >
              {copy[LABEL_KEY[entry.key]]}
            </Link>
          ))}
        </nav>

        <Link href={cartHref} className="shop-bag">{copy['shopChrome.bag']}</Link>
      </div>
    </header>
  )
}
