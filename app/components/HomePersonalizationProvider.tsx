'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { logPersonalizationFetchFailure, type HomePersonalization } from '@/lib/home-personalization'

/**
 * Marketplace static-shell — Sprint 4 (Phase 2). The static homepage is a CDN asset
 * (S1/S2): no `currentUser()`, no `headers()`. This provider re-adds the signed-in
 * personalization as a progressive enhancement — it gets a Clerk JWT client-side and
 * does ONE fetch (not a poll) to the S3 Cloud Run endpoint after hydration, then exposes
 * the raw data to the two island slots (`HomeRetomaOffers`, `HomeSellerModule`).
 *
 * It mirrors the `FavoritesProvider` idiom: signed-out short-circuits, a `cancelled`
 * guard, best-effort try/catch. The static render never blocks on it — `data` is `null`
 * during SSR / loading / signed-out / failure.
 *
 * `isLoaded`/`isSignedIn` are exposed alongside `data` (2026-07) so the two island slots
 * can tell "still resolving the session" (render nothing, matches the static/signed-out
 * markup, no hydration mismatch) apart from "signed-in, fetch pending" (render a
 * skeleton) apart from "confirmed nothing" (render nothing). Previously both cases
 * collapsed to `data === null` and both slots just returned `null` until the fetch
 * landed, which is what caused the homepage pop-in.
 *
 * `storeUrl`/`publishableApiKey` are passed as props from the Server Component parent
 * (`app/(site)/page.tsx`), which reads them server-side at request time — the same
 * pattern `<ClerkProvider>` (`app/layout.tsx`) uses internally. Reading them here via
 * `process.env.NEXT_PUBLIC_*` directly (the original approach) requires Next to inline
 * the value at `next build` time; the Cloud Run image build never passes those as Docker
 * build-args, so the client bundle silently fell back to `http://localhost:9000` / `""`
 * for every visitor since the Vercel→Cloud Run cutover — not a CORS issue, despite what
 * this comment used to say (see `sprint-1.md` Story 1.1 for the live-bundle evidence).
 */

type HomePersonalizationContextValue = {
  data: HomePersonalization | null
  /** Mirrors Clerk's `isLoaded` — false only for the brief window before the client
   * knows whether there's a session at all. Slots render nothing in this state, same
   * as the static/signed-out render, so there's never a skeleton flash for anonymous
   * visitors while Clerk is still starting up. */
  isLoaded: boolean
  /** True once we know the visitor is signed in. */
  isSignedIn: boolean
  /** Flips true once the personalization fetch has FINISHED — success or failure alike.
   * `isSignedIn && !data` is ambiguous on its own: it means "in flight" before the fetch
   * settles and "we tried and got nothing" after. Without this third state a failed fetch
   * shimmers a skeleton forever instead of degrading to nothing, and failure is a routine
   * outcome here, not a corner case — the S3 endpoint's CORS admits the prod origin only
   * (so every preview fails it), and the bundle once fell back to `localhost:9000` for
   * every visitor (see the storeUrl note above). Skeleton on `!settled`, never on `!data`. */
  settled: boolean
}

const HomePersonalizationContext = createContext<HomePersonalizationContextValue>({
  data: null,
  isLoaded: false,
  isSignedIn: false,
  settled: false,
})

export function useHomePersonalization(): HomePersonalizationContextValue {
  return useContext(HomePersonalizationContext)
}

export default function HomePersonalizationProvider({
  children,
  storeUrl,
  publishableApiKey,
}: {
  children: React.ReactNode
  storeUrl: string
  publishableApiKey: string
}) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const [data, setData] = useState<HomePersonalization | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (!isLoaded) return
    // Clear on sign-out, and clear before each (re)fetch so a sign-out or account switch
    // never leaks the previous user's favorites/offers/seller stats while the new fetch
    // is in flight (or after signing out entirely). `userId` in the deps re-runs this on
    // an account switch (isSignedIn stays true, so it alone wouldn't).
    setData(null)
    setSettled(false)
    if (!isSignedIn) return

    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const res = await fetch(`${storeUrl}/store/home/personalization`, {
          headers: {
            'x-publishable-api-key': publishableApiKey,
            Authorization: `Bearer ${token}`,
          },
        })
        if (!res.ok) {
          if (!cancelled) logPersonalizationFetchFailure(res.status)
          return
        }
        if (cancelled) return
        const json = (await res.json()) as HomePersonalization
        if (!cancelled) setData(json)
      } catch (err) {
        // best-effort progressive enhancement — leave the islands empty, but never silent
        if (!cancelled) logPersonalizationFetchFailure(err)
      } finally {
        // EVERY terminal path lands here — success, non-OK status, thrown error, and the
        // no-token early return. That is the point: the slots key their skeleton off
        // `settled`, so any exit that isn't a cancellation must stop the shimmer, or a
        // failure becomes an infinite loading state. Cancelled runs are excluded because
        // a newer effect pass owns the state by then.
        if (!cancelled) setSettled(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn, userId, getToken, storeUrl, publishableApiKey])

  return (
    <HomePersonalizationContext.Provider value={{ data, isLoaded, isSignedIn: !!isSignedIn, settled }}>
      {children}
    </HomePersonalizationContext.Provider>
  )
}
