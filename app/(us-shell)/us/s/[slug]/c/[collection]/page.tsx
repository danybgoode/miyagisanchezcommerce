import { ShopCollectionPage, generateShopCollectionMetadata } from '@/app/(shell)/s/[slug]/c/[collection]/page'

type Props = { params: Promise<{ slug: string; collection: string }> }
export function generateMetadata({ params }: Props) { return generateShopCollectionMetadata({ params, market: 'us', marketBasePath: '/us' }) }
export default function UnitedStatesShopCollectionPage({ params }: Props) { return ShopCollectionPage({ params, market: 'us', marketBasePath: '/us' }) }
