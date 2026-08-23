import type { Metadata, Viewport } from 'next'
import MarketDocument, { ROOT_METADATA, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

export const metadata: Metadata = ROOT_METADATA
export const viewport: Viewport = ROOT_VIEWPORT

export default function PublicPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketDocument market="mx">
      <PlatformThemeScript />
      <PlatformShell market="mx" platformThemeEligible>{children}</PlatformShell>
      <ReferralAttribution />
    </MarketDocument>
  )
}
