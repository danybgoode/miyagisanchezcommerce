import type { Metadata } from 'next'
import { rootSelectorMetadata } from '@/lib/market-seo'
import MarketSelector from '@/app/(site)/MarketSelector'

/**
 * `/en` — the master-brand market selector, English telling.
 *
 * The twin of `/`. Same component, same dictionary keys; the language comes from
 * this route's own layout (`(en-site)` mounts the US market document, so the copy,
 * `<html lang>`, Clerk localization and chrome are all English) rather than from
 * anything this file decides.
 *
 * It exists because the front door was Spanish-only. An English-reading visitor
 * landed on "Tu tienda es tuya. El mercado es por país." and had to guess; the
 * platform operates a US market and recruits US merchants, so the page that asks
 * which market you want could not be readable in only one of the two.
 *
 * `lib/root-language.ts` carries the reasoning for two static documents over one
 * `Accept-Language`-sniffing page — briefly: `/` must stay a CDN asset, and
 * Cloudflare would not vary its cache key on the header anyway.
 */

/**
 * Bounds the CDN TTL. A prerendered page with no `revalidate` is served
 * `s-maxage=31536000`, and the edge then keeps serving HTML that references
 * `/_next/static/chunks/*` deleted by the next deploy — the unstyled-homepage
 * failure of 2026-08-06. Matches `/` and `/mx` at 60s.
 */
export const revalidate = 60

export const metadata: Metadata = {
  title: 'Miyagi Sánchez — Your own shop, and a market in every country',
  description:
    'Explore the Miyagi Sánchez markets in Mexico and the United States, or open your own shop and sell to whoever you want.',
  ...rootSelectorMetadata('en'),
}

export default function EnglishMarketSelectorPage() {
  return <MarketSelector language="en" />
}
