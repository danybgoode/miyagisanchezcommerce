import Link from 'next/link'
import { CATEGORIES } from '@/lib/types'

type Props = {
  activeCategory?: string
  className?: string
}

export default function CategoryChips({ activeCategory, className }: Props) {
  return (
    <div className={`chip-rail${className ? ` ${className}` : ''}`}>
      {/* "All" chip — clears category filter */}
      <Link
        href="/l"
        className={`chip${!activeCategory ? ' is-selected' : ''}`}
      >
        <span>🛍️</span>
        <span>Todo</span>
      </Link>

      {CATEGORIES.map(cat => (
        <Link
          key={cat.key}
          href={`/l?category=${cat.key}`}
          className={`chip${cat.key === activeCategory ? ' is-selected' : ''}`}
        >
          <span>{cat.icon}</span>
          <span>{cat.label}</span>
        </Link>
      ))}
    </div>
  )
}
