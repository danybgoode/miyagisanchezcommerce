import {
  ShopAcercaPage,
  generateShopAcercaMetadata,
} from '@/app/(shell)/s/[slug]/acerca/page'

type Props = { params: Promise<{ slug: string }> }

export function generateMetadata({ params }: Props) {
  return generateShopAcercaMetadata({ params, market: 'mx', marketBasePath: '/mx' })
}

export default function MexicoShopAcercaPage({ params }: Props) {
  return ShopAcercaPage({ params, market: 'mx', marketBasePath: '/mx' })
}
