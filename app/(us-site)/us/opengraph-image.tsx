import { createMarketingOgImage, marketingOgContentType, marketingOgSize } from '@/lib/marketing-og'

export const alt = 'Miyagi Sánchez — Independent shops in the United States'
export const size = marketingOgSize
export const contentType = marketingOgContentType

/** Locale-owned artwork: the US marketplace must not inherit Mexico's OG copy. */
export default function UnitedStatesMarketplaceOgImage() {
  return createMarketingOgImage({
    eyebrow: 'Marketplace for the United States',
    title: 'Discover independent shops and one-of-a-kind finds',
    lead: 'Browse products and services from independent sellers across the United States.',
    path: '/us',
    tags: ['Marketplace', 'Independent shops', 'Local sellers', 'AI-ready'],
  })
}
