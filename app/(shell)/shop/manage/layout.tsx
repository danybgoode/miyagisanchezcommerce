import { headers } from 'next/headers'
import SellerShellChrome from './_components/SellerShellChrome'

/**
 * Seller-mode shell for `/shop/manage/*`.
 *
 * The root `app/layout.tsx` already suppresses the buyer header/footer/MobileTabBar
 * here (via `isSellerModePath`); this nested layout fills that space with
 * `SellerShellChrome` (the brand top bar + `SellerNav` rail/bar + its flag-safe
 * nav/badge data, extracted so `app/(shell)/sell/layout.tsx` can render the
 * identical shell for a signed-in shop owner — catalog-management epic, Sprint 6
 * · Story 6.1).
 *
 * Composition with white-label: on a custom domain/subdomain the root layout wraps
 * everything in `ChannelLayout`, so rendering the seller shell here too would stack
 * two shells. We detect white-label from the same middleware headers and defer —
 * the channel shell owns the chrome; manage just renders plain inside it. This is
 * the "no double-suppression" guarantee, enforced on both layers consistently.
 */
export default async function SellerManageLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers()
  const isEmbed = hdrs.get('x-miyagi-embed') === '1'
  const channel = hdrs.get('x-miyagi-channel')
  const isChannel = channel === 'custom' || channel === 'subdomain'
  const whiteLabel = isEmbed || isChannel

  // White-label host → the root ChannelLayout already owns the chrome. Render the
  // manage pages plainly inside it; no seller shell, no stacked bars.
  if (whiteLabel) return <>{children}</>

  return <SellerShellChrome>{children}</SellerShellChrome>
}
