import Link from 'next/link'
import { CATEGORIES } from '@/lib/types'
import type { CategoryCount } from '@/lib/home-curation'

type Props = {
  activeCategory?: string
  className?: string
  /**
   * S3.3 — Pasillos live counts. When provided, each chip shows its listing count
   * and the lead chip reads "Todas →" instead of "Todo" (only categories with ≥1
   * listing appear, per `getCategoryCounts`/`liveCategoryCounts`). Omit for the
   * plain nav-chip variant (e.g. `/l`'s filter bar) — unchanged, zero regression.
   */
  counts?: CategoryCount[]
}

export default function CategoryChips({ activeCategory, className, counts }: Props) {
  // Degrade to the full static list (no counts) when the live-counts fetch comes
  // back empty — a transient `getCategoryCounts()` gap must never take the whole
  // browse-by-category rail down with it (that's a distinct concern from the
  // "only categories with ≥1 listing" rule the Categorías list section applies).
  const hasCounts = !!counts && counts.length > 0
  // Normalize to one shape regardless of source, so the render below never casts.
  const items: ReadonlyArray<{ key: string; label: string; icon: string; count?: number }> = hasCounts
    ? counts!
    : CATEGORIES
  return (
    <div className={`chip-rail${className ? ` ${className}` : ''}`}>
      {/* Lead chip — clears category filter */}
      <Link
        href="/l"
        className={`chip${!activeCategory ? ' is-selected' : ''}`}
      >
        <i className="iconoir-view-grid" aria-hidden />
        <span>{hasCounts ? 'Todas →' : 'Todo'}</span>
      </Link>

      {items.map(cat => (
        <Link
          key={cat.key}
          href={`/l?category=${cat.key}`}
          className={`chip${cat.key === activeCategory ? ' is-selected' : ''}`}
        >
          <i className={`iconoir-${cat.icon}`} aria-hidden />
          <span>{cat.label}</span>
          {cat.count !== undefined && <span className="chip-count">{cat.count}</span>}
        </Link>
      ))}
    </div>
  )
}
