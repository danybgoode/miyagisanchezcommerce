import type { SearchParams } from '@/lib/types'
import { ListingsPage } from '../../l/page'
import { marketCatalogCanonical } from '@/lib/market-seo'

export const metadata = marketCatalogCanonical('/mx/l')

export default function MexicoListingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  return ListingsPage({ searchParams, market: 'mx', marketBasePath: '/mx' })
}
