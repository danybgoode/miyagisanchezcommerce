/**
 * PWA bottom-bar visibility — pure, next-free helpers.
 *
 * The MobileTabBar client island imports these; the api spec
 * (`e2e/tabbar-visibility.spec.ts`) loads them directly. Keeping the logic here
 * (no DOM, no `next/*`) means the hide rules can't drift between component and
 * test. Same pattern as `lib/gallery.ts` ↔ `e2e/gallery.spec.ts`.
 */

/** How tab labels render. The const below is the single switch (no Flagsmith, no peek mode). */
export type LabelMode = 'icons-only' | 'active-label' | 'full-labels'

/**
 * Default label rendering for the bar:
 *   'icons-only'   — icon + aria-label only (no visible text) ← default
 *   'active-label' — text shown on the active tab only
 *   'full-labels'  — text shown on every tab
 */
export const LABEL_MODE: LabelMode = 'icons-only'

/**
 * The bar is removed entirely (not just hidden) on these surfaces — full-screen
 * flows where the bottom chrome would cover content: the PDP, checkout, an open
 * conversation, and the publish wizard.
 *
 * Detail routes only — the `/l` and `/messages` *index* pages keep the bar.
 *   true  → /l/<id>, /checkout[...], /messages/<id>, /sell[...]
 *   false → /l, /l?…, /messages, /, /account, …
 */
export function shouldHideTabBar(pathname: string): boolean {
  if (!pathname) return false
  // Detail routes: a non-empty segment after the base.
  if (/^\/l\/[^/]+/.test(pathname)) return true
  if (/^\/messages\/[^/]+/.test(pathname)) return true
  // Whole-section flows: the base or anything under it.
  if (pathname === '/checkout' || pathname.startsWith('/checkout/')) return true
  if (pathname === '/sell' || pathname.startsWith('/sell/')) return true
  return false
}

/**
 * Hide-on-scroll decision (pure). Given the previous and current scroll Y, the
 * current hidden state, and an 8px threshold, return the next hidden state:
 *   - near the top (y ≤ threshold) → always shown
 *   - scrolled down past the threshold delta → hide
 *   - any upward move → show
 *   - sub-threshold jitter → unchanged
 */
export function nextTabBarHidden(
  prevY: number,
  currentY: number,
  hidden: boolean,
  threshold = 8,
): boolean {
  if (currentY <= threshold) return false
  const delta = currentY - prevY
  if (delta > threshold) return true
  if (delta < 0) return false
  return hidden
}
