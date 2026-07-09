/**
 * lib/announcements.ts
 *
 * The stateful half of the announcement reader (epic 08 · admin-content-and-announcements,
 * Sprint 3) — composes the pure `resolveActiveAnnouncement` (`lib/announcements-merge.ts`)
 * with a fail-open Supabase read. Structural copy of `lib/copy-overrides.ts`:
 *
 *  1. FAIL-OPEN. `fetchAnnouncementRowsBounded()` is bounded (2s, `Promise.race`, no
 *     retries), try/catch-all, NEVER throws, returns `null` on any error/timeout. An
 *     unreachable/slow Supabase means no announcement renders anywhere — never an error.
 *  2. ISR-SAFE CACHE. Wrapped in `unstable_cache` (same primitive `copy-overrides.ts`
 *     uses), `revalidate: 60` + `tags: ['announcements']` — safe to call from the static
 *     homepage (`app/(site)/page.tsx`) without forcing it dynamic.
 *     `revalidateTag('announcements')` on an admin save makes the change visible
 *     immediately rather than waiting out the window.
 *  3. `content.overrides_enabled` gates the read via `isEnabled()` — its existing doc
 *     comment already covers "the Sprint 3 announcement banners," so no new flag key.
 */
import 'server-only'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { resolveActiveAnnouncement, type AnnouncementRow, type Audience } from '@/lib/announcements-merge'

const TABLE = 'platform_announcements'

/** In-cache freshness window (seconds) — mirrors copy-overrides.ts's 60s TTL. */
export const ANNOUNCEMENT_CACHE_REVALIDATE_SECONDS = 60

/** Bounded fetch budget (ms) — mirrors copy-overrides.ts's OVERRIDE_FETCH_TIMEOUT_MS. */
const ANNOUNCEMENT_FETCH_TIMEOUT_MS = 2_000

type Row = {
  id: unknown
  audience: unknown
  text: unknown
  cta_label: unknown
  cta_link: unknown
  starts_at: unknown
  ends_at: unknown
  active: unknown
}

function toAnnouncementRow(r: Row): AnnouncementRow {
  return {
    id: String(r.id),
    audience: r.audience === 'buyer' ? 'buyer' : 'seller',
    text: String(r.text),
    ctaLabel: r.cta_label == null ? null : String(r.cta_label),
    ctaLink: r.cta_link == null ? null : String(r.cta_link),
    startsAt: r.starts_at == null ? null : String(r.starts_at),
    endsAt: r.ends_at == null ? null : String(r.ends_at),
    active: Boolean(r.active),
  }
}

/**
 * Read every announcement row from Supabase, bounded to ~2s. Returns `null` on
 * timeout/error (an empty table returns `[]`) — either way the caller fails open.
 * Structural copy of `lib/copy-overrides.ts`'s `fetchOverrideRowsBounded()`.
 */
async function fetchAnnouncementRowsBounded(): Promise<AnnouncementRow[] | null> {
  try {
    const query = db
      .from(TABLE)
      .select('id, audience, text, cta_label, cta_link, starts_at, ends_at, active')
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('platform_announcements fetch timeout')), ANNOUNCEMENT_FETCH_TIMEOUT_MS),
    )
    const { data, error } = (await Promise.race([query, timeout])) as {
      data: Row[] | null
      error: unknown
    }
    if (error || !data) return null
    return data.map(toAnnouncementRow)
  } catch {
    return null
  }
}

const getCachedAnnouncementRows = unstable_cache(
  fetchAnnouncementRowsBounded,
  ['announcements'],
  { revalidate: ANNOUNCEMENT_CACHE_REVALIDATE_SECONDS, tags: ['announcements'] },
)

/** Fail-open: never throws. An unreachable Supabase (or an empty table) yields `[]`. */
export async function getAnnouncements(): Promise<AnnouncementRow[]> {
  try {
    const rows = await getCachedAnnouncementRows()
    return rows ?? []
  } catch {
    return []
  }
}

/**
 * Public entry point for both placements — the single live row for `audience`, or
 * `null` (no active campaign, flag OFF, or a fetch failure). Gated by the same
 * `content.overrides_enabled` kill-switch the copy-override layer uses.
 */
export async function getActiveAnnouncement(audience: Audience): Promise<AnnouncementRow | null> {
  const enabled = await isEnabled('content.overrides_enabled')
  if (!enabled) return null

  const rows = await getAnnouncements()
  if (rows.length === 0) return null

  return resolveActiveAnnouncement(rows, audience, Date.now())
}
