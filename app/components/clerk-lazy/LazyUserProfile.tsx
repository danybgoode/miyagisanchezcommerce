'use client'

import dynamic from 'next/dynamic'

// hyper-performant-website S2 · Story 2.2 — see LazySignIn.tsx's header
// comment for the full rationale; same treatment for the /account/settings
// Clerk-hosted account-management surface (<UserProfile>).
const UserProfile = dynamic(() => import('@clerk/nextjs').then((mod) => mod.UserProfile), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      style={{ width: '100%', height: 480, borderRadius: 12, background: 'var(--bg-sunk)' }}
    />
  ),
})

export default UserProfile
