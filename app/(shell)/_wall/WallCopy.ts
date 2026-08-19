import type { Dictionary } from '@/lib/dictionary'

/**
 * Living Shop — the Wall's copy slice (epic 07, Sprint 2).
 *
 * The Wall renders as SERVER components (SEO, and a card that needs no
 * hydration should not ship any), so it cannot use the client-side
 * `BuyerCopyText`. It takes the dictionary slice as a prop instead — which is
 * also what keeps every string out of the components themselves and the buyer
 * locale population green.
 */

export type WallCopy = Dictionary['buyerCopy']

/** Everything a Wall card needs that is not the entry itself. */
export interface WallCardContext {
  copy: WallCopy
  /** `''` on an owned host, `/mx/s/<slug>` on the marketplace. */
  basePath: string
  /** BCP-47 tag for dates — the market decides it, never the server's zone. */
  htmlLang: string
  /** The shop posts as itself: its name and avatar head every entry (Story 8.3). */
  shopName: string
  shopLogoUrl: string | null
  /**
   * ONE render-time instant, passed in rather than read per card.
   *
   * Reading the clock inside each card could straddle midnight mid-list and
   * label two posts from the same minute "hoy" and "ayer".
   */
  now: Date
}

/**
 * A date the way a shop's visitor should read it. Explicitly parameterized by
 * language: a hardcoded 'es-MX' here would render a US shop's Wall in Spanish
 * dates, and the buyer population guard fails the build for exactly that.
 */
export function formatWallDate(iso: string, htmlLang: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString(htmlLang, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "3 artículos" / "1 artículo" — the singular is a separate authored string, not a suffix rule. */
export function collectionCountLabel(copy: WallCopy, count: number): string {
  if (count === 1) return copy['wall.collectionCountOne']
  return copy['wall.collectionCount'].replace('{0}', String(count))
}
