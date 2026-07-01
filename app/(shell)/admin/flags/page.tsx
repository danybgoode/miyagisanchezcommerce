import { requireAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { FLAG_KEYS, FLAG_META } from '@/lib/flags-admin'
import FlagsAdminClient, { type FlagView } from './FlagsAdminClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Flags — Admin' }

type FlagRow = {
  key: string
  enabled: boolean
  polarity: string | null
  description: string | null
  updated_at: string | null
  updated_by: string | null
}

/**
 * Admin control surface for the in-house feature flags (epic 09 · feature-flags-inhouse,
 * Sprint 2). Clerk-gated read-only list here; the toggles POST to `/api/admin/flags`.
 *
 * The view UNIONS the known flags (`FLAG_KEYS`) with the live `platform_flags` rows so a
 * flag whose row is ABSENT still renders — an absent row means `isEnabled()` falls open to
 * its DEFAULT_FLAGS value (`FLAG_META[key].default`), which is exactly what we show, tagged
 * "por defecto" until it's first flipped (which inserts the row).
 */
export default async function AdminFlagsPage() {
  await requireAdmin()

  let rows: FlagRow[] = []
  try {
    const { data } = await db
      .from('platform_flags')
      .select('key, enabled, polarity, description, updated_at, updated_by')
    rows = (data ?? []) as FlagRow[]
  } catch {
    // Non-fatal — the client can refresh; unknown rows fall back to defaults below.
  }

  const byKey = new Map(rows.map((r) => [r.key, r]))
  const flags: FlagView[] = FLAG_KEYS.map((key) => {
    const row = byKey.get(key)
    const meta = FLAG_META[key]
    return {
      key,
      polarity: meta.polarity,
      // Live value: the row's `enabled` when present, else the fail-open default.
      enabled: row ? row.enabled : meta.default,
      // `true` while no row exists yet (serving the DEFAULT_FLAGS value).
      isDefault: !row,
      description: row?.description ?? null,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    }
  })

  return <FlagsAdminClient initialFlags={flags} />
}
