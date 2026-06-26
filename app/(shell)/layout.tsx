import { headers } from 'next/headers'
import ChannelLayout from '@/app/(shell)/s/[slug]/ChannelLayout'
import TrustSignals from '@/app/components/TrustSignals'
import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import { AgentContextProvider } from '@/app/components/AgentContext'
import { getShop } from '@/lib/listings'
import { deriveShopTrustInputs } from '@/lib/trust-inputs'
import { isPlatformThemeEligiblePath } from '@/lib/platform-theme'
import { isSellerModePath } from '@/lib/seller-mode'

/**
 * Dynamic `(shell)` shell — holds the per-request chrome decision that used to live in
 * the root layout (which is now static so the `(site)` homepage can go static). Reading
 * `headers()` here opts THIS subtree into dynamic rendering without tainting `(site)`.
 *
 * Three modes, byte-identical to the old root layout:
 *   • white-label (embed iframe OR live custom-domain / subdomain) → `ChannelLayout`
 *   • buyer chrome (everything else on the platform) → `PlatformShell`
 *   • seller-mode (`/shop/manage/*`) → bare `<main>` (the nested manage layout fills it)
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // The embeddable full-shop iframe (/embed/*) is white-label — middleware tags it so we
  // drop the platform header/footer/tab bar and render just the shop.
  const hdrs = await headers()
  const isEmbed = hdrs.get('x-miyagi-embed') === '1'
  const platformPath = hdrs.get('x-miyagi-path') ?? '/'

  // Custom-domain ("own channel") AND subdomain (slug.miyagisanchez.com) requests are
  // white-label: middleware tags them with the resolved shop slug so we drop platform
  // chrome here and wrap the WHOLE storefront in the shop's branded shell.
  const channel = hdrs.get('x-miyagi-channel')
  const isChannel = channel === 'custom' || channel === 'subdomain'
  const channelSlug = hdrs.get('x-miyagi-shop-slug') ?? ''
  const channelDomain = hdrs.get('x-miyagi-domain') ?? ''
  const channelShop = isChannel && channelSlug ? await getShop(channelSlug) : null
  const channelSettings = ((channelShop?.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const channelTheme = (channelSettings.theme ?? {}) as { accent_color?: string | null }
  const channelAccent = channelTheme.accent_color ?? '#1d6f42'

  // White-label = no platform chrome (embed iframe OR a live custom domain).
  const whiteLabel = isEmbed || isChannel

  // Seller-mode shell (/shop/manage/*): also drop the buyer chrome — the nested
  // app/(shell)/shop/manage/layout.tsx renders a seller-distinct shell in this
  // suppressed space. This mirrors the whiteLabel branch and composes with it: a manage
  // page on a custom domain/subdomain is already whiteLabel, so the nested layout defers
  // to ChannelLayout and never double-suppresses or stacks two shells.
  const sellerMode = isSellerModePath(platformPath)
  const showBuyerChrome = !whiteLabel && !sellerMode

  const platformThemeEligible = !whiteLabel && isPlatformThemeEligiblePath(platformPath)

  return (
    // AgentContextProvider wraps both the chrome (where AIAgentButton's card lives) and
    // {children} (where a server page's <SetAgentContext> pushes its details) so the
    // hand-off prompt can name the actual product/shop. No-op on white-label/seller-mode.
    <AgentContextProvider>
      {/* Seasonal-theme boot script (beforeInteractive) — only on eligible platform
          pages (`/l*`, `/agent`), never white-label/embed/ineligible. The static root
          can't gate by path, so it's emitted here where eligibility is known. */}
      {platformThemeEligible && <PlatformThemeScript />}
      {isChannel && channelShop ? (
        <ChannelLayout
          shopName={channelShop.name}
          accentColor={channelAccent}
          logoUrl={channelShop.logo_url ?? null}
          domain={channelDomain}
          trust={
            // Epic D / D.2 — slim trust chips beside the assurance lead line the shell
            // renders. paymentProtected is suppressed here (the lead line "Pago seguro ·
            // Compra protegida" already carries that assurance).
            <TrustSignals
              variant="slim"
              channel={channel === 'custom' ? 'custom_domain' : 'subdomain'}
              {...deriveShopTrustInputs(channelShop.metadata as Record<string, unknown> | null, channelShop.verified)}
              paymentProtected={false}
            />
          }
        >
          {children}
        </ChannelLayout>
      ) : showBuyerChrome ? (
        <PlatformShell platformThemeEligible={platformThemeEligible}>
          {children}
        </PlatformShell>
      ) : (
        <main>{children}</main>
      )}
      <ReferralAttribution />
    </AgentContextProvider>
  )
}
