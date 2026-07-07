import Link from 'next/link'
import type { Listing } from '@/lib/types'
import { deriveShopCollections } from '@/lib/collection-derive'

/**
 * Shop nav strip (own-shop premium presentation, Sprint 2) — "Todos · Die-cut
 * · Zines…". Rendered on the shop page AND every collection page so buyers
 * can jump between sections from either. `basePath` is the channel-
 * appropriate prefix (`/s/${slug}` on the marketplace, `''` on-channel);
 * `activeShortSlug` highlights the current collection (`null` = "Todos").
 * `activeTextColor` is the caller's already-computed `readableTextOn(accent)`
 * (Sprint 1's fix for a light/pastel accent needing dark ink, not hardcoded
 * white — same pattern as AnnouncementBar/HeroSection's `textColor` prop).
 */
export default function ShopCollectionNav({
  listings,
  collections,
  basePath,
  sellerSlug,
  accent,
  activeTextColor,
  activeShortSlug,
}: {
  listings: Listing[]
  collections: Array<{ id: string; handle: string; name: string; sort_order: number }>
  basePath: string
  sellerSlug: string
  accent: string
  activeTextColor: string
  activeShortSlug: string | null
}) {
  if (collections.length === 0) return null

  const entries = deriveShopCollections(listings, collections, basePath, sellerSlug)

  return (
    <nav className="max-w-6xl mx-auto px-4 mb-4 overflow-x-auto">
      <ul className="flex items-center gap-2 whitespace-nowrap">
        {entries.map((entry) => {
          const isActive = entry.shortSlug === activeShortSlug
          return (
            <li key={entry.shortSlug ?? 'todos'}>
              <Link
                href={entry.href}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border no-underline transition-colors"
                style={isActive
                  ? { backgroundColor: accent, borderColor: accent, color: activeTextColor }
                  : { borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
                }
              >
                {entry.label}
                <span className="text-xs opacity-70">{entry.count}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
