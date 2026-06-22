import PlatformShell from '@/app/components/PlatformShell'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import ReferralAttribution from '@/app/components/ReferralAttribution'

/**
 * Marketplace `(site)` shell — STATIC, header-free layout chain. Renders the platform
 * buyer chrome unconditionally (this tree is never white-label: the only route here is
 * the homepage `/`, which middleware guarantees channels never reach — custom-domain /
 * subdomain `/` are rewritten to `/s/[slug]` in the dynamic `(shell)` tree, embed is
 * only `/embed/*`, seller is only `/shop/manage*`). `/` is always theme-eligible.
 *
 * Reads no request headers → the homepage can be served as a static CDN asset once S2
 * drops its `currentUser()` call. (In S1 the page still personalizes, so it stays
 * dynamic — but its layout chain no longer forces it.)
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Homepage `/` is always theme-eligible — emit the beforeInteractive boot script
          here (the static root can't gate by path). */}
      <PlatformThemeScript />
      <PlatformShell platformThemeEligible>{children}</PlatformShell>
      <ReferralAttribution />
    </>
  )
}
