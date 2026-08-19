import type { Metadata } from 'next'
import { marketLandingMetadata, rootSelectorMetadata } from '@/lib/market-seo'
import MarketSelector from './MarketSelector'

/**
 * `/` — the master-brand market selector, Spanish telling.
 *
 * Epic 07 · market-architecture-foundation, Story 2.1 (decision D7). Until that
 * cutover `/` WAS the Mexico marketplace homepage; it now lives at `/mx`
 * (`app/(mx-site)/mx/page.tsx`) and this page took its place.
 *
 * The markup lives in `MarketSelector`, shared with the English root at `/en`
 * (`app/(en-site)/en/page.tsx`). Each root supplies only its metadata and its
 * language; every string comes from the dictionary its own layout mounts. See
 * `lib/root-language.ts` for why the two languages are two static documents rather
 * than one page reading `Accept-Language`.
 */

/**
 * The page holds no data, so this window is NOT about content freshness — it is
 * about the build-scoped asset URLs the HTML embeds.
 *
 * This page used to carry no `revalidate` at all, reasoned from "there is
 * nothing here that can go stale". That reasoning was wrong, and it broke the
 * homepage in production (2026-08-06): a prerender with no `revalidate` is
 * served with `s-maxage=31536000`, Cloudflare cached `/` on that one-year TTL,
 * and the HTML kept pointing at `/_next/static/chunks/*` hashes from the build
 * that produced it. Those chunks are deleted the moment a new Cloud Run
 * revision takes over, so the edge served a 7-day-old document whose CSS 404'd
 * — an unstyled homepage, while every other route (all of which do carry a
 * `revalidate`) rendered fine.
 *
 * The content is static; the asset hashes are not. A page is only as cacheable
 * as the shortest-lived thing its HTML references. 60s matches `/mx` and, with
 * Next's `stale-while-revalidate`, bounds post-deploy breakage to roughly one
 * request instead of a year.
 */
export const revalidate = 60

export const metadata: Metadata = {
  title: 'Miyagi Sánchez — Tu tienda propia y los mercados por país',
  description:
    'Explora los mercados de Miyagi Sánchez en México y Estados Unidos, o abre tu propia tienda y véndele a quien quieras.',
  ...rootSelectorMetadata('es'),
}

export default function MarketSelectorPage() {
  return <MarketSelector language="es" />
}

// Referenced so a future edit that drops the market-landing metadata helper from
// this tree fails the type check rather than silently un-canonicalizing `/mx`.
export type MarketLandingMetadata = ReturnType<typeof marketLandingMetadata>
