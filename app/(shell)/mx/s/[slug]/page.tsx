import { ShopPage, generateShopMetadata } from '../../../s/[slug]/page'

type Props = { params: Promise<{ slug: string }> }

export function generateMetadata({ params }: Props) {
  return generateShopMetadata({ params, market: 'mx', marketBasePath: '/mx' })
}

export default function MexicoShopPage({ params }: Props) {
  return ShopPage({ params, market: 'mx', marketBasePath: '/mx' })
}
