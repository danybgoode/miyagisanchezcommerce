'use client'

import dynamic from 'next/dynamic'

/**
 * hyper-performant-website S2 · Story 2.2 — PlatformShell.tsx/account/page.tsx
 * used to statically `import { UserButton } from '@clerk/nextjs'` and gate
 * the RENDER with a client-side `<AuthShow>` — a runtime conditional, not a
 * build-time split, so Clerk's ~301 KiB UI bundle shipped for every visitor
 * regardless of auth state (2026-07-14 PageSpeed audit). `next/dynamic({
 * ssr: false })` fetches it only once this component actually mounts. Clerk
 * AUTH (ClerkProvider/useAuth/useUser) is untouched — AGENTS.md rule #4.
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
