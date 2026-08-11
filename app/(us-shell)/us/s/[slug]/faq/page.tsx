import { ShopFaqPage, generateShopFaqMetadata } from '@/app/(shell)/s/[slug]/faq/page'

type Props = { params: Promise<{ slug: string }> }
export function generateMetadata({ params }: Props) { return generateShopFaqMetadata({ params, market: 'us', marketBasePath: '/us' }) }
export default function UnitedStatesShopFaqPage({ params }: Props) { return ShopFaqPage({ params, market: 'us', marketBasePath: '/us' }) }
