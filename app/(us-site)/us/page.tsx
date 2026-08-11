import type { Metadata } from 'next'
import { MarketHomePage } from '@/app/(mx-site)/mx/page'
import { marketLandingMetadata } from '@/lib/market-seo'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Miyagi Sánchez United States — Marketplace',
  description: 'Browse independent US shops and listings in the Miyagi Sánchez marketplace.',
  robots: { index: true, follow: true },
  ...marketLandingMetadata('us'),
}

/** Literal US landing adapter; the implementation is shared with Mexico. */
export default function UnitedStatesMarketplacePage() {
  return MarketHomePage({ market: 'us' })
}
