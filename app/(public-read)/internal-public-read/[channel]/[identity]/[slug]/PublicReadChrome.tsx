import { notFound } from 'next/navigation'
import ChannelLayout from '@/app/(shell)/s/[slug]/ChannelLayout'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import TrustSignals from '@/app/components/TrustSignals'
import { getShop } from '@/lib/listings'
import { deriveShopTrustInputs } from '@/lib/trust-inputs'
import { isPublicReadChannel } from '@/lib/public-read'

type Props = {
  children: React.ReactNode
  params: Promise<{ channel: string; identity: string; slug: string }>
  surface: 'shop' | 'listing'
}

export default async function PublicReadChrome({ children, params, surface }: Props) {
  const { channel, identity, slug } = await params
  if (!isPublicReadChannel(channel)) notFound()
  const shop = await getShop(slug, channel === 'marketplace' ? 'mx' : undefined)
  if (!shop) notFound()

  if (channel === 'marketplace') {
    const themed = surface === 'listing'
    return (
      <>
        {themed && <PlatformThemeScript />}
        <PlatformShell market="mx" platformThemeEligible={themed}>{children}</PlatformShell>
      </>
    )
  }
  // The shipped embed page already owns its ChannelLayout.
  if (channel === 'embed') return children

  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as { accent_color?: string | null }
  const trust = deriveShopTrustInputs(shop.metadata as Record<string, unknown> | null, shop.verified)
  return (
    <ChannelLayout
      shopName={shop.name}
      accentColor={theme.accent_color ?? '#1d6f42'}
      logoUrl={shop.logo_url ?? null}
      domain={identity}
      trust={<TrustSignals variant="slim" channel="subdomain" {...trust} paymentProtected={false} />}
    >
      {children}
    </ChannelLayout>
  )
}
