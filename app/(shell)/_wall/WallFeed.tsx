import Link from 'next/link'
import WallEntryCard from './WallEntryCard'
import WallLoadMore from './WallLoadMore'
import type { WallCardContext } from './WallCopy'
import { visibleEntries } from '@/lib/wall/feed'
import type { PublicWallEntry } from '@/lib/wall/types'

/**
 * Living Shop — the Wall (epic 07, Story 2.1).
 *
 * The shop homepage's narrative. Pinned entry first, then newest-first; the
 * initial page is bounded and "see more" fetches the next one, so a merchant with
 * two years of history costs a first-time visitor twelve cards, not two years.
 *
 * An entry whose reference is `unavailable` is dropped HERE, once, rather than in
 * each card — one rule, one place (S7.5). A post is never dropped; it has no
 * reference to lose.
 */

export default function WallFeed({
  entries,
  hasMore,
  ctx,
  shopSlug,
  emptyShopHref,
}: {
  entries: PublicWallEntry[]
  hasMore: boolean
  ctx: WallCardContext
  shopSlug: string
  /** Where the empty state sends a visitor — the catalog is always there. */
  emptyShopHref: string
}) {
  const shown = visibleEntries(entries)

  // A shop with nothing on its Wall gets a DESIGNED state that still routes to
  // the catalog, never an empty feed shell. "Nothing posted yet" and "the shop is
  // broken" must not look the same.
  if (shown.length === 0) {
    return (
      <section aria-labelledby="wall-empty" className="max-w-2xl mx-auto px-4 pb-10">
        <div className="border border-dashed border-[var(--color-border)] rounded-xl p-8 text-center">
          <h2 id="wall-empty" className="text-base font-semibold m-0">{ctx.copy['wall.emptyTitle']}</h2>
          <p className="text-sm text-[var(--color-muted)] mt-1.5 mb-4">{ctx.copy['wall.emptyBody']}</p>
          <Link
            href={emptyShopHref}
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium no-underline text-white"
            style={{ background: 'var(--shop-accent)' }}
          >
            {ctx.copy['wall.emptyCta']}
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="wall-heading" className="max-w-2xl mx-auto px-4 pb-10">
      {/* A real, visible heading: on the homepage the Wall sits above the product
          grid, and an unlabelled stack of cards between the hero and the catalog
          reads as chrome. It is also the landmark a screen reader announces. */}
      <h2 id="wall-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-3">
        {ctx.copy['wall.sectionLabel']}
      </h2>
      <div className="flex flex-col gap-3">
        {shown.map((entry) => (
          <WallEntryCard key={entry.id} entry={entry} ctx={ctx} />
        ))}
      </div>
      {hasMore && (
        <WallLoadMore
          shopSlug={shopSlug}
          initialOffset={entries.length}
          ctx={ctx}
        />
      )}
    </section>
  )
}
