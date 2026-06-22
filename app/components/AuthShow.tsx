'use client'

import { useAuth } from '@clerk/nextjs'

/**
 * Client-side replacement for Clerk's SERVER `<Show when=…>` in the platform chrome.
 *
 * Clerk's server `<Show>` calls `auth()` → `headers()`, which forces the whole route to
 * render dynamically — that's what kept the marketplace homepage a per-request function
 * (the ~30 s cold-start) even after its `currentUser()` was removed
 * (marketplace-static-shell S2). This gates on the Clerk *client* session instead, so
 * `PlatformShell` reads no request headers and the `(site)` tree is a static CDN asset.
 *
 * Signed-out is the default until Clerk confirms a session, so the prerendered/static
 * HTML carries the signed-out chrome — the anonymous SSR that the `nav-entry-points` /
 * `home-chrome` specs assert — then swaps to the signed-in chrome on hydration. On the
 * (already-dynamic) `(shell)` pages this means the header's auth-dependent bits hydrate
 * client-side (a brief swap) rather than SSR (Daniel-approved tradeoff, 2026-06-22).
 *
 * Mirrors Clerk `<Show>`'s `when` API so it's a drop-in swap.
 */
export default function AuthShow({
  when,
  children,
}: {
  when: 'signed-in' | 'signed-out'
  children: React.ReactNode
}) {
  const { isLoaded, isSignedIn } = useAuth()
  const signedIn = isLoaded && !!isSignedIn
  const show = when === 'signed-in' ? signedIn : !signedIn
  return show ? <>{children}</> : null
}
