'use client'

import dynamic from 'next/dynamic'

/**
 * hyper-performant-website S2 · Story 2.2 — `<SignIn>` is already on its own
 * ROUTE (/sign-in), so Next.js route-based code splitting keeps its bundle
 * out of every OTHER page already. This wrapper is the belt-and-suspenders
 * half of the acceptance criteria ("lazy-mount sign-in/up components on
 * interaction/route"): it also stops the Clerk UI chunk from being eagerly
 * fetched by Next's default viewport `<Link prefetch>` behavior on the
 * always-visible "Iniciar sesión" link in PlatformShell — the chunk now only
 * loads once this component actually mounts on /sign-in itself. Clerk AUTH
 * is untouched (AGENTS.md rule #4); this defers only the form UI's bundle.
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
