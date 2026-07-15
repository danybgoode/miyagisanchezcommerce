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
  const items = counts ?? CATEGORIES
  return (
    <div className={`chip-rail${className ? ` ${className}` : ''}`}>
      {/* Lead chip — clears category filter */}
      <Link
        href="/l"
        className={`chip${!activeCategory ? ' is-selected' : ''}`}
      >
        <i className="iconoir-view-grid" aria-hidden />
        <span>{counts ? 'Todas →' : 'Todo'}</span>
      </Link>

      {items.map(cat => (
        <Link
          key={cat.key}
          href={`/l?category=${cat.key}`}
          className={`chip${cat.key === activeCategory ? ' is-selected' : ''}`}
        >
          <i className={`iconoir-${cat.icon}`} aria-hidden />
          <span>{cat.label}{counts ? ` ${(cat as CategoryCount).count}` : ''}</span>
        </Link>
      ))}
    </div>
  )
}
