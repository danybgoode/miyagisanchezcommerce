import { ListingPage, generateListingMetadata } from '../../../l/[id]/page'

type Props = { params: Promise<{ id: string }> }

export function generateMetadata({ params }: Props) {
  return generateListingMetadata({ params, market: 'mx', marketBasePath: '/mx' })
}

export default function MexicoListingPage({ params }: Props) {
  return ListingPage({ params, market: 'mx', marketBasePath: '/mx' })
}
