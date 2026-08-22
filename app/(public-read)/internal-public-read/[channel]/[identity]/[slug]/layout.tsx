import type { Metadata, Viewport } from 'next'
import MarketDocument, { ROOT_METADATA, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import { AgentContextProvider } from '@/app/components/AgentContext'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

export const metadata: Metadata = ROOT_METADATA
export const viewport: Viewport = ROOT_VIEWPORT

type Props = {
  children: React.ReactNode
}

/** D7: channel/host identity is internal path data; this chain performs no request read. */
export default function PublicReadLayout({ children }: Props) {
  return (
    <MarketDocument market="mx">
      <AgentContextProvider>{children}</AgentContextProvider>
      <ReferralAttribution />
    </MarketDocument>
  )
}
