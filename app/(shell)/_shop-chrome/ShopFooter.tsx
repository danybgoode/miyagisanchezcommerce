import Link from 'next/link'
import { navEntries } from '@/lib/shop-presentation/sections'
import type { SectionConfig, SectionAvailability, SectionKey } from '@/lib/shop-presentation/types'
import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the shop footer (epic 07, Story 8.6).
 *
 * The page closes rather than stops. Its links come from `navEntries` — the SAME
 * derivation the header uses — so the footer cannot offer a destination the nav
 * has correctly hidden, which is exactly the bug the old footer content-links
 * block had before Sprint 3 removed it.
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

export default function ShopFooter({
  shopName,
  config,
  availability,
  basePath,
  copy,
}: {
  shopName: string
  config: SectionConfig
  availability: SectionAvailability
  basePath: string
  copy: Dictionary['buyerCopy']
}) {
  const entries = navEntries(config, availability, basePath)
  return (
    <footer className="shop-footer">
      <span className="shop-footer-name">{shopName}</span>
      <nav className="shop-footer-links" aria-label={copy['shopNav.label']}>
        {entries.map((entry) => (
          <Link key={entry.key} href={entry.path}>{copy[LABEL_KEY[entry.key]]}</Link>
        ))}
      </nav>
      <span className="shop-footer-platform">{copy['shopChrome.poweredBy']}</span>
    </footer>
  )
}
