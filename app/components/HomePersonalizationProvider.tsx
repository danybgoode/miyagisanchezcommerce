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
 * during SSR / loading / signed-out / failure, so both slots render nothing until real
 * data lands.
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

type HomePersonalizationContextValue = { data: HomePersonalization | null }

const HomePersonalizationContext = createContext<HomePersonalizationContextValue>({ data: null })

export function useHomePersonalization(): HomePersonalization | null {
  return useContext(HomePersonalizationContext).data
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

  useEffect(() => {
    if (!isLoaded) return
    // Clear on sign-out, and clear before each (re)fetch so a sign-out or account switch
    // never leaks the previous user's favorites/offers/seller stats while the new fetch
    // is in flight (or after signing out entirely). `userId` in the deps re-runs this on
    // an account switch (isSignedIn stays true, so it alone wouldn't).
    setData(null)
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
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn, userId, getToken, storeUrl, publishableApiKey])

  return (
    <HomePersonalizationContext.Provider value={{ data }}>
      {children}
    </HomePersonalizationContext.Provider>
  )
}
