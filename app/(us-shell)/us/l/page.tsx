import type { SearchParams } from '@/lib/types'
import { ListingsPage } from '@/app/(shell)/l/page'
import { marketCatalogCanonical } from '@/lib/market-seo'

export const metadata = marketCatalogCanonical('/us/l')

export default function UnitedStatesListingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return ListingsPage({ searchParams, market: 'us', marketBasePath: '/us' })
}
