/**
 * lib/market-seo.ts — canonical, hreflang and x-default for the market surfaces.
 *
 * Epic 07 · market-architecture-foundation, Story 2.4. The contract:
 *
 *   /     the master-brand market selector → `x-default`, self-canonical
 *   /mx   the Mexico marketplace           → self-canonical, `es-MX`
 *   /us   the US invitation page (Sprint 3) → self-canonical, `en-US`
 *
 * ── Two rules that are easy to get wrong, so they are encoded rather than
 *    remembered ───────────────────────────────────────────────────────────────
 *
 * 1. AN ALTERNATE IS A PROMISE THAT A PAGE EXISTS. Emitting
 *    `hreflang="en-US" href="…/us"` before `/us` is a real route points every
 *    crawler that honours it at a 404 — a worse signal than no signal. So the
 *    language alternates are derived from `MARKET_LANDING_PAGES`, the markets
 *    that actually have a landing route today, and `e2e/market-seo.spec.ts`
 *    asserts each listed market really has `app/(site)/<code>/page.tsx` on disk.
 *    The list is therefore mechanically checked, not hand-trusted, and Sprint 3
 *    adding `/us` is a one-word change that its own spec verifies.
 *
 * 2. A CATALOG PAGE EMITS NO LANGUAGE ALTERNATES AT ALL. A product, browse or
 *    shop page under `/mx` has no `/us` counterpart and never will while the US
 *    marketplace is `invitation` — there is no `/us/l/<id>` route, by design
 *    (D9: `/us` has zero children, so a US catalog URL is a structural 404).
 *    Claiming an alternate there would advertise a page that cannot exist. Those
 *    pages get a self-canonical and nothing else.
 *
 * `/us-eng` (or any language-in-the-market-segment spelling) is not produced by
 * anything here: locale is a FIELD ON a market record, never a URL segment
 * (`lib/markets.ts`, D3). A spec asserts its absence, because the absence is the
 * point.
 *
 * PURE apart from the `Metadata` type import — no request state, no env, so the
 * static `/` and ISR `/mx` renders stay static.
 */

import type { Metadata } from 'next'
import { MARKETS, marketBasePath, requireMarket, type MarketCode } from './markets'

/** The canonical platform origin for every marketplace URL. */
export const SITE_ORIGIN = 'https://miyagisanchez.com'

/**
 * Markets that have a real landing page in the route tree today.
 *
 * Sprint 3 adds `'us'` here in the same commit that creates
 * `app/(site)/us/page.tsx` — and cannot add it earlier, because the spec checks
 * the file exists. See rule 1 in the module header.
 */
export const MARKET_LANDING_PAGES: readonly MarketCode[] = ['mx', 'us']

/** Absolute URL for a platform path. */
export function absoluteUrl(pathname: string): string {
  return `${SITE_ORIGIN}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

/** `{ 'es-MX': 'https://…/mx', … }` for every market whose landing page exists. */
function landingLanguageAlternates(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const code of MARKET_LANDING_PAGES) {
    out[MARKETS[code].default_locale] = absoluteUrl(marketBasePath(code))
  }
  // The selector is the language-neutral entry point: a visitor whose locale
  // matches no market lands there and chooses, rather than being guessed at.
  out['x-default'] = absoluteUrl('/')
  return out
}

/**
 * Metadata for the master-brand selector at `/`.
 *
 * Self-canonical (it is a real page with its own content, not a redirect), and
 * `x-default` — it is the correct destination for any locale we do not operate
 * in, which is most of them.
 */
export function selectorMetadata(): Pick<Metadata, 'alternates'> {
  return {
    alternates: {
      canonical: absoluteUrl('/'),
      languages: landingLanguageAlternates(),
    },
  }
}

/**
 * Metadata for a market's landing page (`/mx`, and `/us` in Sprint 3).
 *
 * Self-canonical, plus the same language map — so `/mx` names itself as the
 * `es-MX` surface and `/` as `x-default`, which is the reciprocity crawlers
 * expect.
 */
export function marketLandingMetadata(market: MarketCode): Pick<Metadata, 'alternates'> {
  const record = requireMarket(market)
  return {
    alternates: {
      canonical: absoluteUrl(marketBasePath(record.code)),
      languages: landingLanguageAlternates(),
    },
  }
}

/**
 * Self-canonical for a market-scoped CATALOG page (browse, PDP, shop).
 *
 * No `languages` key at all — see rule 2 in the module header. `pathname` is the
 * already-market-prefixed platform path (`/mx/l/prod_…`).
 */
export function marketCatalogCanonical(pathname: string): Pick<Metadata, 'alternates'> {
  return { alternates: { canonical: absoluteUrl(pathname) } }
}
