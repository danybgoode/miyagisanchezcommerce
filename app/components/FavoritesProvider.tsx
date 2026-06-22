'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'

/**
 * Client-side heart-state hydration for the STATIC marketplace homepage
 * (marketplace-static-shell S2). The homepage is a static CDN asset — it can no longer
 * seed `favoritedIds` server-side — so this provider does ONE `/api/favorites` fetch on
 * mount (signed-in only) and exposes a `medusa_product_id` lookup that every
 * `FavoriteButton` under it reads from. It runs after hydration, so it never blocks the
 * static render: hearts paint unfilled, then fill for signed-in users.
 *
 * Context value is `null` when no provider is mounted, so `FavoriteButton` keeps its
 * server-seeded `initialFavorited` behavior everywhere else (PDP, /l, /account/favorites).
 */
type FavoritesContextValue = {
  ready: boolean
  isFavorited: (medusaId: string) => boolean
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function useFavoritesContext(): FavoritesContextValue | null {
  return useContext(FavoritesContext)
}

// The GET /api/favorites row shape we need: the joined listing's medusa_product_id
// (Supabase widens a to-one join to an array, so accept either).
type FavoriteRow = {
  marketplace_listings?:
    | { medusa_product_id?: string | null }
    | { medusa_product_id?: string | null }[]
    | null
}

function medusaIdOf(row: FavoriteRow): string | null {
  const listing = row.marketplace_listings
  if (Array.isArray(listing)) return listing[0]?.medusa_product_id ?? null
  return listing?.medusa_product_id ?? null
}

export default function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth()
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setReady(true)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/favorites')
        if (!res.ok) return
        const data = (await res.json()) as { favorites?: FavoriteRow[] }
        if (cancelled) return
        setIds(
          new Set(
            (data.favorites ?? [])
              .map(medusaIdOf)
              .filter((id): id is string => !!id),
          ),
        )
      } catch {
        // best-effort progressive enhancement — leave hearts unfilled on failure
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn])

  return (
    <FavoritesContext.Provider value={{ ready, isFavorited: (id) => ids.has(id) }}>
      {children}
    </FavoritesContext.Provider>
  )
}
