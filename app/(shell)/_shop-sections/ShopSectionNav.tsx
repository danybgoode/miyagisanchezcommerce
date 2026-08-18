import Link from 'next/link'
import { navEntries } from '@/lib/shop-presentation/sections'
import type { SectionConfig, SectionAvailability, SectionKey } from '@/lib/shop-presentation/types'
import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the ONE shop nav (epic 07, Story 3.2).
 *
 * It replaces the collection strip on the homepage rather than sitting beside
 * it: two nav bars on one storefront is the outcome Story 3.2 forbids by name.
 * The collection chips are not lost — they move to the destinations where they
 * are a filter rather than a navigation (`/tienda` and `/colecciones`), which is
 * what they always were.
 *
 * Same markup on all three channels. `basePath` (`''` on an owned host,
 * `/mx/s/<slug>` on the marketplace) is resolved once by the caller, so there is
 * no per-channel branch here to get wrong.
 *
 * A section appears only when the seller kept it AND it has content — see
 * `navSections`. So a hidden section and an empty one both produce no link,
 * never a dead one.
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

export default function ShopSectionNav({
  config,
  availability,
  basePath,
  active,
  accent,
  activeTextColor,
  copy,
}: {
  config: SectionConfig
  availability: SectionAvailability
  basePath: string
  /** The section currently being viewed, or null on a route that is not one. */
  active: SectionKey | null
  accent: string
  activeTextColor: string
  copy: Dictionary['buyerCopy']
}) {
  const entries = navEntries(config, availability, basePath)
  // Wall + Shop always exist, so this can only be empty if the config was
  // corrupted past normalization — in which case rendering nothing beats
  // rendering a bar with one broken item.
  if (entries.length === 0) return null

  return (
    <nav aria-label={copy['shopNav.label']} className="max-w-6xl mx-auto px-4 mb-5 overflow-x-auto">
      <ul className="flex items-center gap-2 whitespace-nowrap list-none p-0 m-0">
        {entries.map((entry) => {
          const isActive = entry.key === active
          return (
            <li key={entry.key}>
              <Link
                href={entry.path}
                aria-current={isActive ? 'page' : undefined}
                className="inline-flex items-center text-sm px-3 py-1.5 rounded-full border no-underline transition-colors"
                style={isActive
                  ? { backgroundColor: accent, borderColor: accent, color: activeTextColor }
                  : { borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
                }
              >
                {copy[LABEL_KEY[entry.key]]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
