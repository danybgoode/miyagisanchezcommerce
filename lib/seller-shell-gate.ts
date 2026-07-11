/**
 * lib/seller-shell-gate.ts
 *
 * Owner-aware eligibility gate for rendering the seller shell (dark top bar +
 * `SellerNav`, see `app/(shell)/shop/manage/_components/SellerShellChrome.tsx`)
 * over `/sell` and `/sell/setup` for a signed-in shop owner — catalog-management
 * epic, Sprint 6 · Story 6.1.
 *
 * Deliberately a SEPARATE file from `lib/seller-mode.ts`: `isSellerModePath`
 * stays a pure, auth-free path predicate (its own api spec depends on that), so
 * ownership/auth/flag logic lives here instead, never folded into it.
 *
 * `isSellShellCandidatePath` (re-exported here, defined in `lib/sell-shell-path.ts`)
 * mirrors `isSellerModePath`'s own discipline — pure, no `next/*`/auth imports,
 * directly unit-testable — but matches ONLY the exact strings `/sell` and
 * `/sell/setup` (not a prefix), so sibling routes like `/sell/edit/[id]` and
 * `/sell/print/[editionId]` are entirely unaffected. It lives in its OWN file
 * (not inline here) because THIS file imports `server-only`/`@clerk/nextjs/server`
 * — a Playwright `api` spec can't load a module with those imports, so the pure
 * predicate has to be dependency-free at the file level, not just at the
 * function level.
 *
 * `sellShellEligible` chains, cheapest/most-likely-to-short-circuit first:
 *   1. the pure path fast-path (zero async work for every other route in the app)
 *   2. `currentUser()` — most `/sell` traffic is signed-out (the acquisition
 *      path), so failing here first avoids a Supabase flag read on the common case
 *   3. the kill-switch flag `seller.shell_on_sell_enabled`
 *   4. `getMySeller()` — the shared, request-memoized Medusa ownership lookup
 *      (`lib/get-my-seller.ts`), also used by `app/(shell)/sell/page.tsx` itself,
 *      so a signed-in owner's request costs one Medusa round-trip, not two.
 *
 * Wrapped in React's `cache()` so both call sites in the same request
 * (`app/(shell)/layout.tsx` and the new `app/(shell)/sell/layout.tsx`) share one
 * evaluation — they must derive `pathname` identically (`headers().get('x-miyagi-path')`)
 * for the memo key to match.
 */
import 'server-only'
import { cache } from 'react'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getMySeller } from '@/lib/get-my-seller'
import { isSellShellCandidatePath } from '@/lib/sell-shell-path'

export { isSellShellCandidatePath }

export const sellShellEligible = cache(async (pathname: string): Promise<boolean> => {
  if (!isSellShellCandidatePath(pathname)) return false

  const user = await currentUser()
  if (!user) return false

  if (!(await isEnabled('seller.shell_on_sell_enabled'))) return false

  const seller = await getMySeller()
  return seller !== null
})
