import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Lazy singleton. createClient is deferred to first property access so that
 * Next.js build-time module evaluation never crashes when env vars are absent
 * in preview/development environments. If both vars are missing a stub is
 * returned so routes fail gracefully at runtime rather than at build time.
 */
let _db: SupabaseClient | null = null
function getDb(): SupabaseClient {
  if (_db) return _db
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    // Return a minimal stub so builds in envs without service-role creds don't crash.
    // Real routes will still return errors at runtime, which is the correct behaviour.
    console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — using stub')
    _db = { from: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'not configured' } }) } as unknown) } as unknown as SupabaseClient
    return _db
  }
  _db = createClient(url, key)
  return _db
}

export const db = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const client = getDb()
    const val = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof val === 'function' ? val.bind(client) : val
  },
})
