import type { Metadata, Viewport } from 'next'
import MarketDocument, { marketRootMetadata, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

/**
 * `(en-site)` — the English root shell. One route lives here: `/en`, the English
 * telling of the market selector.
 *
 * ── Why `market="us"` on a page that has not chosen a market ─────────────────
 * The chrome has to be in SOME language, and in this codebase language is a
 * property of a market (`lib/market-presentation.ts`: `mx → es`, `us → en`). There
 * is no market-less English document type, so the English selector borrows the US
 * market's presentation exactly as the Spanish selector at `/` has always borrowed
 * Mexico's — `app/(site)/layout.tsx` mounts `market="mx"` for the same reason.
 *
 * That inherits the US chrome's own destinations, and they are the right ones for
 * this reader: the header's "Post for free" resolves to `/us/sell`, and browse
 * goes to `/us/l`. A visitor who wants Mexico picks it from the selector itself,
 * which is the page's entire job.
 *
 * ── Static, header-free ──────────────────────────────────────────────────────
 * Reads no request headers, exactly like `(site)` — that split is what keeps both
 * roots servable as CDN assets rather than per-request functions
 * (`Roadmap/LEARNINGS.md`, marketplace-static-shell). The language decision happens
 * client-side, after hydration, in `RootLanguageSwitch`.
 */
export const metadata: Metadata = marketRootMetadata('us')
export const viewport: Viewport = ROOT_VIEWPORT

export default function EnglishSiteLayout({ children }: { children: React.ReactNode }) {
  {/* `/en` is always theme-eligible — emit the beforeInteractive boot script here
      (the static root cannot gate by path), matching `(site)`. */}
  return (
    <MarketDocument market="us">
      <PlatformThemeScript />
      <PlatformShell market="us" platformThemeEligible>{children}</PlatformShell>
      <ReferralAttribution />
    </MarketDocument>
  )
}
