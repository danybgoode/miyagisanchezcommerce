import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import Link from 'next/link'
import { LISTING_TYPE_FILTERS } from '@/lib/listing-query'
import type { SearchParams } from '@/lib/types'

type Props = {
  params: SearchParams
  className?: string
  marketBasePath?: string
}

// Build an /l href from the current params, setting (or clearing) listing_type.
// Unlike CategoryChips, this preserves every other active filter — tapping a type
// must not wipe the buyer's q / category / state / sort. Resets pagination.
function hrefFor(params: SearchParams, value: string | null, marketBasePath: string): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'listing_type' || k === 'page') continue
    if (v != null && v !== '') sp.set(k, String(v))
  }
  if (value) sp.set('listing_type', value)
  const qs = sp.toString()
  return qs ? `${marketBasePath}/l?${qs}` : `${marketBasePath}/l`
}

export default function ListingTypeChips({ params, className, marketBasePath = '' }: Props) {
  const active = params.listing_type ?? ''
  return (
    <div className={`chip-rail${className ? ` ${className}` : ''}`}>
      {/* "Todos" — clears the type filter */}
      <Link href={hrefFor(params, null, marketBasePath)} className={`chip${!active ? ' is-selected' : ''}`}>
        <span><BuyerCopyText copyKey="components.ListingTypeChips.6609e719" /></span>
      </Link>

      {LISTING_TYPE_FILTERS.map(t => (
        <Link
          key={t.value}
          href={hrefFor(params, t.value, marketBasePath)}
          className={`chip${t.value === active ? ' is-selected' : ''}`}
        >
          <span>{t.label}</span>
        </Link>
      ))}
    </div>
  )
}
