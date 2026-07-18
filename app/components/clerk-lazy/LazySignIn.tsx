'use client'

import dynamic from 'next/dynamic'

/**
 * hyper-performant-website S2 · Story 2.2 — belt-and-suspenders on top of
 * Next's route-based code splitting (/sign-in is already its own route):
 * also stops the Clerk UI chunk being eagerly fetched by `<Link prefetch>`
 * on PlatformShell's always-visible "Iniciar sesión" link. Clerk AUTH is
 * untouched (AGENTS.md rule #4); this defers only the form UI's bundle.
 */
const SignIn = dynamic(() => import('@clerk/nextjs').then((mod) => mod.SignIn), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      style={{ width: '100%', maxWidth: 400, height: 420, borderRadius: 12, background: 'var(--bg-sunk)' }}
    />
  ),
})

export default SignIn
