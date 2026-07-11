/**
 * lib/get-my-seller.ts
 *
 * Shared, request-memoized "does the signed-in Clerk user own a Medusa shop"
 * lookup. Medusa's `/store/sellers/me` stays the single source of truth for
 * seller ownership (per AGENTS.md rule 1 — never substitute a Clerk claim or a
 * cookie for commerce truth). Wrapped in React's `cache()` (per-request only,
 * NOT `unstable_cache` — this is identity-scoped, not safe to share across
 * requests/users) so every caller in the same request tree that needs "is this
 * user a shop owner, and which shop" shares ONE Medusa round-trip instead of
 * each caller re-fetching independently.
 *
 * Extracted from `app/(shell)/sell/page.tsx`'s original inline fetch (catalog-
 * management epic, Sprint 6 · Story 6.1) — that page and the new seller-shell
 * eligibility gate (`lib/seller-shell-gate.ts`) both need this exact lookup for
 * the same request; sharing it avoids a duplicate live commerce read purely for
 * page-chrome decisions.
 */
import 'server-only'
import { cache } from 'react'
import { currentUser, auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export interface MySeller {
  id: string
  slug: string
  name: string
  location: string | null
}

/**
 * Returns the signed-in user's shop, or `null` if signed out or no shop yet.
 * Memoized per-request via `cache()` — safe to call from multiple layouts/pages
 * in the same render tree.
 */
export const getMySeller = cache(async (): Promise<MySeller | null> => {
  const user = await currentUser()
  if (!user) return null

  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return null

  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me`, {
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })
  if (!res.ok) return null

  const { seller } = await res.json() as {
    seller: { id: string; slug: string; name: string; location: string | null }
  }
  return {
    id: seller.id,
    slug: seller.slug,
    name: seller.name,
    location: seller.location ?? null,
  }
})
