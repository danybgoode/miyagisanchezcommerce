import Link from 'next/link'
import { LISTING_TYPE_FILTERS } from '@/lib/listing-query'
import type { SearchParams } from '@/lib/types'

type Props = {
  params: SearchParams
  className?: string
}

// Build an /l href from the current params, setting (or clearing) listing_type.
// Unlike CategoryChips, this preserves every other active filter — tapping a type
// must not wipe the buyer's q / category / state / sort. Resets pagination.
function hrefFor(params: SearchParams, value: string | null): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'listing_type' || k === 'page') continue
    if (v != null && v !== '') sp.set(k, String(v))
  }
  if (value) sp.set('listing_type', value)
  const qs = sp.toString()
  return qs ? `/l?${qs}` : '/l'
}

export default function ListingTypeChips({ params, className }: Props) {
  const active = params.listing_type ?? ''
  return (
    <div className={`chip-rail${className ? ` ${className}` : ''}`}>
      {/* "Todos" — clears the type filter */}
      <Link href={hrefFor(params, null)} className={`chip${!active ? ' is-selected' : ''}`}>
        <span>Todos</span>
      </Link>

      {LISTING_TYPE_FILTERS.map(t => (
        <Link
          key={t.value}
          href={hrefFor(params, t.value)}
          className={`chip${t.value === active ? ' is-selected' : ''}`}
        >
          <span>{t.label}</span>
        </Link>
      ))}
    </div>
  )
}
