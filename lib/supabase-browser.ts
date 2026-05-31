'use client'

/**
 * Browser Supabase client — anon key + the Clerk session token (native
 * third-party auth). Used ONLY for RLS-scoped realtime reads. All writes go
 * through server API routes (service-role). Never import the service-role
 * client (`lib/supabase`) into client code.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and the
 * Clerk↔Supabase integration enabled (Clerk session token carries
 * role=authenticated; sub = clerk user id, matched by RLS policies).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useSession } from '@clerk/nextjs'
import { useMemo, useRef } from 'react'

export function useSupabaseBrowser(): SupabaseClient {
  const { session } = useSession()
  // Always resolve the freshest token without recreating the client.
  const tokenRef = useRef<() => Promise<string | null>>(async () => null)
  tokenRef.current = async () => (await session?.getToken()) ?? null

  return useMemo(
    () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          accessToken: () => tokenRef.current(),
          auth: { persistSession: false, autoRefreshToken: false },
        },
      ),
    [],
  )
}
