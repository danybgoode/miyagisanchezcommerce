import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import MarketDocument, { ROOT_METADATA, ROOT_VIEWPORT } from '@/app/components/MarketDocument'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import ChannelLayout from '@/app/(shell)/s/[slug]/ChannelLayout'
import TrustSignals from '@/app/components/TrustSignals'
import { getShop } from '@/lib/listings'
import { deriveShopTrustInputs } from '@/lib/trust-inputs'
import { isPublicReadChannel } from '@/lib/public-read'
import '@/app/globals.css'
import '@/app/iconoir-subset.css'

export const metadata: Metadata = ROOT_METADATA
export const viewport: Viewport = ROOT_VIEWPORT

type Props = {
  children: React.ReactNode
  params: Promise<{ channel: string; identity: string; slug: string }>
}

/** D7: channel/host identity is internal path data; this chain performs no request read. */
export default async function PublicReadLayout({ children, params }: Props) {
  const { channel, slug } = await params
  if (!isPublicReadChannel(channel)) notFound()

  const shop = await getShop(slug, channel === 'marketplace' ? 'mx' : undefined)
  if (!shop) notFound()

  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as { accent_color?: string | null }
  const accent = theme.accent_color ?? '#1d6f42'
  const trust = deriveShopTrustInputs(shop.metadata as Record<string, unknown> | null, shop.verified)

  return (
    <MarketDocument market="mx">
      {channel === 'marketplace' ? (
        <>
          <PlatformThemeScript />
          <PlatformShell market="mx" platformThemeEligible>{children}</PlatformShell>
          <ReferralAttribution />
        </>
      ) : (
        <ChannelLayout
          shopName={shop.name}
          accentColor={accent}
          logoUrl={shop.logo_url ?? null}
          domain=""
          trust={<TrustSignals variant="slim" channel={channel} {...trust} paymentProtected={false} />}
        >
          {children}
        </ChannelLayout>
      )}
    </MarketDocument>
  )
}
