import { ShopPage, generateShopMetadata } from '@/app/(shell)/s/[slug]/page'

type Props = { params: Promise<{ slug: string }> }

export function generateMetadata({ params }: Props) {
  return generateShopMetadata({ params, market: 'us', marketBasePath: '/us' })
}

export default function UnitedStatesShopPage({ params }: Props) {
  return ShopPage({ params, market: 'us', marketBasePath: '/us' })
}
