import { ShopPage, generateShopMetadata } from '@/app/(shell)/s/[slug]/page'

// D9: owner preview is deliberately separate from the revalidated public tree.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props) {
  return generateShopMetadata({ params, market: 'mx', marketBasePath: '/mx' })
}

export default async function PublicOwnerPreviewPage({ params, searchParams }: Props) {
  return ShopPage({ params, searchParams, market: 'mx', marketBasePath: '/mx' })
}
