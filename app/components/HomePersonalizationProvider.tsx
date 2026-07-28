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
  // The fetch result is stored WITH the session it belongs to, and `data`/`settled` are then
  // DERIVED from it during render rather than reset by the effect. That is what removes the
  // sign-out/account-switch clear (the old `setData(null)` at the top of the effect): a result
  // whose key no longer matches the current session simply stops counting, so the previous
  // user's favorites/offers/seller stats can never be read even for one frame.
  //
  // Deriving it also keeps the effect free of synchronous setState, which the
  // `react-hooks/set-state-in-effect` rule bans — a reset-then-refetch is exactly the cascading
  // render the rule exists to stop, and here the reset was never real state to begin with.
  const [fetched, setFetched] = useState<{ key: string; data: HomePersonalization | null } | null>(null)

  // Identifies the session a result belongs to. `userId` is in here, not just `isSignedIn`,
  // because an account switch keeps `isSignedIn` true — without it the new session would read
  // the previous user's result as its own.
  const sessionKey = `${isLoaded ? 'ready' : 'loading'}:${isSignedIn ? 'in' : 'out'}:${userId ?? ''}`

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    let cancelled = false
    ;(async () => {
      let result: HomePersonalization | null = null
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
        result = (await res.json()) as HomePersonalization
      } catch (err) {
        // best-effort progressive enhancement — leave the islands empty, but never silent
        if (!cancelled) logPersonalizationFetchFailure(err)
      } finally {
        // EVERY terminal path lands here — success, non-OK status, thrown error, and the
        // no-token early return — recording the attempt even when it produced nothing. That is
        // the point: the slots key their skeleton off `settled`, so any exit that isn't a
        // cancellation must stop the shimmer, or a failure becomes an infinite loading state.
        // Cancelled runs are excluded because a newer effect pass owns the state by then.
        if (!cancelled) setFetched({ key: sessionKey, data: result })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn, userId, sessionKey, getToken, storeUrl, publishableApiKey])

  // A result only counts for the session that produced it — see the `fetched` note above.
  const settled = fetched?.key === sessionKey
  const data = settled ? fetched!.data : null

  return (
    <HomePersonalizationContext.Provider value={{ data, isLoaded, isSignedIn: !!isSignedIn, settled }}>
      {children}
    </HomePersonalizationContext.Provider>
  )
}
