/**
 * Seller-shell candidate-path predicate — pure, next-free, auth-free.
 *
 * True only for the exact strings `/sell` and `/sell/setup` (never a prefix —
 * `/sell/edit/[id]` and `/sell/print/[editionId]` must be unaffected). Kept in
 * its OWN file, separate from `lib/seller-shell-gate.ts` (which imports
 * `@clerk/nextjs/server`/`server-only`), for the same reason `lib/seller-mode.ts`
 * is kept dependency-free: `e2e/seller-mode.spec.ts` imports this directly, and
 * a module that pulls in Clerk/`server-only` can't be loaded by the Playwright
 * `api` runner (mirrors the `lib/seller-mode.ts` doc comment's own rationale).
 */
const SELL_SHELL_PATHS = new Set(['/sell', '/sell/setup'])

export function isSellShellCandidatePath(pathname: string): boolean {
  if (!pathname) return false
  return SELL_SHELL_PATHS.has(pathname)
}
