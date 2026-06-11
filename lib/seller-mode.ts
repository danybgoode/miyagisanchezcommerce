/**
 * Seller-mode path predicate — pure, next-free.
 *
 * `app/layout.tsx` imports this to decide whether to drop the buyer chrome
 * (header / footer / MobileTabBar) under `/shop/manage`, mirroring the existing
 * `whiteLabel = isEmbed || isChannel` suppression branch. The nested
 * `app/shop/manage/layout.tsx` renders the seller shell in that suppressed space.
 *
 * Kept here (no DOM, no `next/*`) so the api spec (`e2e/seller-mode.spec.ts`)
 * can load it directly and the rule can't drift between the layout and the test.
 * Same pattern as `lib/tabbar-visibility.ts`.
 */

const SELLER_MODE_BASE = '/shop/manage'

/**
 * True for the seller management surface: `/shop/manage` and anything beneath it
 * (`/shop/manage/orders`, `/shop/manage/settings/payments`, …). False for buyer
 * routes — including a `/shop/manage`-prefixed string with no boundary slash
 * (e.g. `/shop/managexyz`), which is not a real route but guarded against anyway.
 */
export function isSellerModePath(pathname: string): boolean {
  if (!pathname) return false
  return pathname === SELLER_MODE_BASE || pathname.startsWith(SELLER_MODE_BASE + '/')
}
