import { ShopPage, generateShopMetadata } from '@/app/(shell)/s/[slug]/page'

type Props = {
  params: Promise<{ slug: string }>
  /** Forwarded so the studio's owner-only preview draft reaches ShopPage (Story 5.5). */
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export function generateMetadata({ params }: Props) {
  return generateShopMetadata({ params, market: 'us', marketBasePath: '/us' })
}

export default function UnitedStatesShopPage({ params, searchParams }: Props) {
  return ShopPage({ params, searchParams, market: 'us', marketBasePath: '/us' })
}
