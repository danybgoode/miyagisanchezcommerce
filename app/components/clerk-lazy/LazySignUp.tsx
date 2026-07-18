'use client'

import dynamic from 'next/dynamic'

// hyper-performant-website S2 · Story 2.2 — see LazySignIn.tsx's header
// comment for the full rationale; same treatment for /sign-up.
const SignUp = dynamic(() => import('@clerk/nextjs').then((mod) => mod.SignUp), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      style={{ width: '100%', maxWidth: 400, height: 420, borderRadius: 12, background: 'var(--bg-sunk)' }}
    />
  ),
})

export default SignUp
