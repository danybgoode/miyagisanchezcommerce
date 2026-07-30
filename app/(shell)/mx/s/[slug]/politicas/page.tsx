import {
  ShopPoliticasPage,
  generateShopPoliciesMetadata,
} from '@/app/(shell)/s/[slug]/politicas/page'

type Props = { params: Promise<{ slug: string }> }

export function generateMetadata({ params }: Props) {
  return generateShopPoliciesMetadata({ params, market: 'mx', marketBasePath: '/mx' })
}

export default function MexicoShopPoliciesPage({ params }: Props) {
  return ShopPoliticasPage({ params, market: 'mx', marketBasePath: '/mx' })
}
