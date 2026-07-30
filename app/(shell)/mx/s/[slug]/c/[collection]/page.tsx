import {
  ShopCollectionPage,
  generateShopCollectionMetadata,
} from '@/app/(shell)/s/[slug]/c/[collection]/page'

type Props = { params: Promise<{ slug: string; collection: string }> }

export function generateMetadata({ params }: Props) {
  return generateShopCollectionMetadata({ params, marketBasePath: '/mx' })
}

export default function MexicoShopCollectionPage({ params }: Props) {
  return ShopCollectionPage({ params, marketBasePath: '/mx' })
}
