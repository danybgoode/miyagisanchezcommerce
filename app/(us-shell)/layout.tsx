import type { Metadata, Viewport } from 'next'
import MarketDocument, { marketRootMetadata, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import { AgentContextProvider } from '@/app/components/AgentContext'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

export const metadata: Metadata = marketRootMetadata('us')
export const viewport: Viewport = ROOT_VIEWPORT

/** Static en-US catalog root. Literal children own market context; no header inference. */
export default function UnitedStatesCatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketDocument market="us">
      <AgentContextProvider>
        <PlatformThemeScript />
        <PlatformShell market="us" platformThemeEligible>{children}</PlatformShell>
        <ReferralAttribution />
      </AgentContextProvider>
    </MarketDocument>
  )
}
