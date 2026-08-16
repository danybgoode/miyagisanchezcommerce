import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import Link from 'next/link'
import { LISTING_TYPE_FILTERS } from '@/lib/listing-query'
import type { SearchParams } from '@/lib/types'
import { listingTypeLabel, type BuyerLanguage } from '@/lib/market-vocabulary'

type Props = {
  params: SearchParams
  className?: string
  marketBasePath?: string
  /**
   * Taken as a PROP, exactly like the sibling `CategoryChips`, rather than read
   * from `useBuyerPresentation()`. This is a server component: calling that hook
   * here threw "Attempted to call useBuyerPresentation() from the server" at
   * request time and 500'd every `/l` browse page in production. `BuyerCopyText`
   * below is a component, not a hook, so it stays fine to render from the server.
   */
  language?: BuyerLanguage
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

export default function ListingTypeChips({ params, className, marketBasePath = '', language = 'es' }: Props) {
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
          <span>{listingTypeLabel(t.value, t.label, language)}</span>
        </Link>
      ))}
    </div>
  )
}
