import { ListingPage, generateListingMetadata } from '@/app/(shell)/l/[id]/page'

type Props = { params: Promise<{ id: string }> }

export function generateMetadata({ params }: Props) {
  return generateListingMetadata({ params, market: 'us', marketBasePath: '/us' })
}

export default function UnitedStatesListingPage({ params }: Props) {
  return ListingPage({ params, market: 'us', marketBasePath: '/us' })
}
