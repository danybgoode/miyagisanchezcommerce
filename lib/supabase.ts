import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Lazy singleton — createClient is deferred until first access so that
 * Next.js static analysis at build time doesn't crash when env vars are
 * absent in preview/development environments.
 */
let _db: SupabaseClient | null = null
export const db = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    if (!_db) {
      _db = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    }
    const val = (_db as unknown as Record<string | symbol, unknown>)[prop]
    return typeof val === 'function' ? val.bind(_db) : val
  },
})
