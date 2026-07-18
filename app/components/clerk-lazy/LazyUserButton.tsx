'use client'

import dynamic from 'next/dynamic'

/**
 * hyper-performant-website S2 · Story 2.2 — Clerk's <UserButton> pulls in
 * Clerk's UI bundle (dist/ui-common_ui_*.js + dist/vendors_ui_*.js +
 * dist/ui.browser.js — ~301 KiB combined, per the 2026-07-14 PageSpeed
 * audit's "Reduce unused JavaScript" finding on the HOMEPAGE, a page a
 * signed-out visitor never needs it on).
 *
 * The root cause: PlatformShell.tsx and account/page.tsx both statically
 * `import { UserButton } from '@clerk/nextjs'` and gate the RENDER with a
 * CLIENT-side `<AuthShow when="signed-in">` — but that's a runtime React
 * conditional, not a build-time code split. The `UserButton` module (and its
 * whole chunk graph) still ships in the page's JS bundle for every visitor,
 * signed in or not, because the import itself is unconditional.
 *
 * `next/dynamic(..., { ssr: false })` moves it to its own chunk, fetched only
 * when this component actually mounts — i.e. only once Clerk confirms a
 * signed-in session client-side. Clerk AUTH itself (ClerkProvider, useAuth,
 * useUser, the session cookie) is completely untouched — AGENTS.md rule #4 —
 * this defers only the account-menu UI widget's bundle.
 */
const UserButton = dynamic(() => import('@clerk/nextjs').then((mod) => mod.UserButton), {
  ssr: false,
  loading: () => (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'inline-block',
        background: 'var(--bg-sunk)',
      }}
    />
  ),
})

export default UserButton
