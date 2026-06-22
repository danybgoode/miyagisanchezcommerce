'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import type { HomePersonalization } from '@/lib/home-personalization'

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
 * data lands. (CORS: the endpoint allows the prod origin only, so on a preview the fetch
 * degrades to nothing — the authed hydration eyeball is owed to Daniel on prod.)
 */

type HomePersonalizationContextValue = { data: HomePersonalization | null }

const HomePersonalizationContext = createContext<HomePersonalizationContextValue>({ data: null })

export function useHomePersonalization(): HomePersonalization | null {
  return useContext(HomePersonalizationContext).data
}

const STORE_URL =
  process.env.NEXT_PUBLIC_MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default function HomePersonalizationProvider({
  children,
}: {
  children: React.ReactNode
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
        const res = await fetch(`${STORE_URL}/store/home/personalization`, {
          headers: {
            'x-publishable-api-key': PUB_KEY,
            Authorization: `Bearer ${token}`,
          },
        })
        if (!res.ok || cancelled) return
        const json = (await res.json()) as HomePersonalization
        if (!cancelled) setData(json)
      } catch {
        // best-effort progressive enhancement — leave the islands empty on failure
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn, userId, getToken])

  return (
    <HomePersonalizationContext.Provider value={{ data }}>
      {children}
    </HomePersonalizationContext.Provider>
  )
}
