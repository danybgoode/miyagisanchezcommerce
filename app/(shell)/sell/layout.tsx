import { headers } from 'next/headers'
import SellerShellChrome from '@/app/(shell)/shop/manage/_components/SellerShellChrome'
import { sellShellEligible } from '@/lib/seller-shell-gate'

/**
 * Seller shell over `/sell` + `/sell/setup` for a signed-in shop owner
 * (catalog-management epic, Sprint 6 · Story 6.1).
 *
 * Mirrors `app/(shell)/shop/manage/layout.tsx`'s whiteLabel-defer shape exactly
 * — same headers, same boolean, same "no double-suppression" guarantee. The
 * root `app/(shell)/layout.tsx` already computes the identical
 * `sellShellEligible(platformPath)` result (memoized per-request via React
 * `cache()`, so this call shares that one evaluation rather than re-running it)
 * to decide whether to suppress buyer chrome; THIS layout is what actually
 * fills the resulting bare `<main>` with the seller shell, exactly the same
 * "root suppresses, nested layout fills" composition `shop/manage/layout.tsx`
 * already uses.
 *
 * Applies to every route under `app/(shell)/sell/` (Next.js layout scoping),
 * but `sellShellEligible`'s own pure fast-path (`isSellShellCandidatePath`)
 * only ever returns true for the exact `/sell`/`/sell/setup` strings — sibling
 * routes like `/sell/edit/[id]` and `/sell/print/[editionId]` fall through to
 * `<>{children}</>` unaffected, unchanged from today.
 */
export default async function SellLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers()
  const isEmbed = hdrs.get('x-miyagi-embed') === '1'
  const channel = hdrs.get('x-miyagi-channel')
  const isChannel = channel === 'custom' || channel === 'subdomain'
  const whiteLabel = isEmbed || isChannel

  // White-label host → the root ChannelLayout already owns the chrome.
  if (whiteLabel) return <>{children}</>

  const platformPath = hdrs.get('x-miyagi-path') ?? '/'
  const eligible = await sellShellEligible(platformPath)

  // Not eligible (signed out, flag off, no shop, or not /sell|/sell/setup) →
  // render plainly; the root layout's PlatformShell wraps this as buyer chrome.
  if (!eligible) return <>{children}</>

  return <SellerShellChrome>{children}</SellerShellChrome>
}
