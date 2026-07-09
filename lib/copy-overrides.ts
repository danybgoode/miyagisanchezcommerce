/**
 * lib/copy-overrides.ts
 *
 * The stateful half of the runtime copy-override reader (epic 08 ·
 * admin-content-and-announcements, Sprint 1) — composes the pure
 * `applyCopyOverrides` (`lib/copy-overrides-merge.ts`) with a fail-open Supabase
 * read, mirroring `lib/flags.ts`'s `platform_flags` pattern:
 *
 *  1. FAIL-OPEN. `fetchOverrideRowsBounded()` is a structural copy of `flags.ts`'s
 *     `fetchRows()` — `Promise.race`-bounded (2 s, no retries), try/catch-all,
 *     NEVER throws, returns `null` on any error/timeout. `getOverrides()` then
 *     never throws either — an unreachable/slow Supabase means an empty override
 *     set, i.e. pure compile-time copy.
 *  2. ISR-SAFE CACHE, not an in-process Map. Unlike `flags.ts` (read only from
 *     already-dynamic paths — checkout gates, admin toggles), copy overrides must
 *     also be readable from the STATIC homepage once Sprint 2 keys it — a
 *     per-request dynamic read there would force `/` off `○`. So the fetch is
 *     wrapped in `unstable_cache` (the same primitive `lib/neighborhood-pulse-server.ts`
 *     already uses to feed the static shell), `revalidate: 60` + `tags:
 *     ['copy-overrides']` — safe to call from any render context, static or
 *     dynamic, and `revalidateTag('copy-overrides')` on an admin save makes the
 *     edit visible immediately rather than waiting out the window.
 *  3. `content.overrides_enabled` gates the READ via the unchanged `isEnabled()` —
 *     OFF skips the Supabase call entirely (pure compile-time copy, always).
 *
 * The injectable-deps core (`resolveOverriddenDictionary`) lives in the pure
 * `lib/copy-overrides-merge.ts` (mirrors this repo's `buildHomePersonalization(deps)`
 * convention, backend `route.ts`, marketplace-static-shell epic) — it's what lets
 * the flag-OFF and empty-overrides fallback branches be unit-tested with zero live
 * Supabase/flags infra. This file just binds the real dependencies.
 */
import 'server-only'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getDictionary, type Dictionary } from '@/lib/dictionary'
import { resolveOverriddenDictionary, type OverrideRow } from '@/lib/copy-overrides-merge'

const TABLE = 'platform_copy_overrides'

/** In-cache freshness window (seconds) — mirrors flags.ts's 60s TTL. */
export const OVERRIDE_CACHE_REVALIDATE_SECONDS = 60

/** Bounded fetch budget (ms) — mirrors flags.ts's FLAG_FETCH_TIMEOUT_MS. */
const OVERRIDE_FETCH_TIMEOUT_MS = 2_000

/**
 * Read every override row from Supabase, bounded to ~2 s. Returns `null` on
 * timeout/error (an empty table returns `[]`) — either way the caller fails open.
 * Structural copy of `lib/flags.ts`'s `fetchRows()`.
 */
async function fetchOverrideRowsBounded(): Promise<OverrideRow[] | null> {
  try {
    const query = db.from(TABLE).select('namespace, key, locale, value')
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('platform_copy_overrides fetch timeout')), OVERRIDE_FETCH_TIMEOUT_MS),
    )
    const { data, error } = (await Promise.race([query, timeout])) as {
      data: Array<{ namespace: unknown; key: unknown; locale: unknown; value: unknown }> | null
      error: unknown
    }
    if (error || !data) return null
    return data.map((r) => ({
      namespace: String(r.namespace),
      key: String(r.key),
      locale: String(r.locale),
      value: String(r.value),
    }))
  } catch {
    return null
  }
}

const getCachedOverrideRows = unstable_cache(
  fetchOverrideRowsBounded,
  ['copy-overrides'],
  { revalidate: OVERRIDE_CACHE_REVALIDATE_SECONDS, tags: ['copy-overrides'] },
)

/** Fail-open: never throws. An unreachable Supabase (or an empty table) yields `[]`. */
export async function getOverrides(): Promise<OverrideRow[]> {
  try {
    const rows = await getCachedOverrideRows()
    return rows ?? []
  } catch {
    return []
  }
}

/** Public entry point — binds the real flags/Supabase/dictionary dependencies. */
export async function getOverriddenDictionary(locale?: string | null): Promise<Dictionary> {
  return resolveOverriddenDictionary({ isEnabled, getOverrides, getDictionary }, locale)
}
