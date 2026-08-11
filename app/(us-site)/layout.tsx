import type { Metadata, Viewport } from 'next'
import MarketDocument, { marketRootMetadata, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

export const metadata: Metadata = marketRootMetadata('us')
export const viewport: Viewport = ROOT_VIEWPORT

/** US invitation root today; S3 adds the sibling `(us-shell)` catalog root. */
export default function UnitedStatesSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketDocument market="us">
      <PlatformThemeScript />
      <PlatformShell market="us" platformThemeEligible>{children}</PlatformShell>
      <ReferralAttribution />
    </MarketDocument>
  )
}
