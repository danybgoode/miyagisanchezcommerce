import type { Metadata, Viewport } from 'next'
import MarketDocument, { marketRootMetadata, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

export const metadata: Metadata = marketRootMetadata('us')
export const viewport: Viewport = ROOT_VIEWPORT

/** Root adapter for `/us`; catalog descendants live under sibling `(us-shell)`. */
export default function UnitedStatesSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketDocument market="us">
      <PlatformThemeScript />
      <PlatformShell market="us" platformThemeEligible>{children}</PlatformShell>
      <ReferralAttribution />
    </MarketDocument>
  )
}
