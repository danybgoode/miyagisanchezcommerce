/**
 * lib/cost-comparator-data.ts
 *
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.2) — the
 * STATEFUL half: composes the pure `applyDatasetOverrides`
 * (`lib/cost-comparator-dataset.ts`) with the real baseline JSON + the SAME
 * fail-open Supabase override reader `/admin/contenido` already uses
 * (`getOverrides()` + `isEnabled('content.overrides_enabled')`,
 * `lib/copy-overrides.ts` / `lib/flags.ts`) — no new flag, no new table. Mirrors
 * `getOverriddenDictionary()`'s shape exactly.
 *
 * FAIL-OPEN by construction: `getOverrides()` already never throws (returns `[]`
 * on any Supabase/timeout error) and `isEnabled()` already falls back to
 * `DEFAULT_FLAGS` — so a Supabase outage or the still-missing prod
 * `platform_copy_overrides` table (owed to Daniel, see the epic README) just means
 * the comparator serves the baseline dataset untouched, same as the homepage.
 */
import 'server-only'
import { getOverrides } from '@/lib/copy-overrides'
import { isEnabled } from '@/lib/flags'
import { applyDatasetOverrides, type ComparatorDataset } from '@/lib/cost-comparator-dataset'
import baselineDataset from '@/lib/cost-comparator-dataset.json' with { type: 'json' }

const BASELINE = baselineDataset as ComparatorDataset

/**
 * Resolve the comparator dataset with any live overrides applied. Never throws —
 * an unreachable Supabase, an empty table, or the flag OFF all fall back to the
 * baseline dataset (the CI-guarded, sourced-and-dated one shipped in this repo).
 */
export async function getComparatorDataset(locale: string = 'es'): Promise<ComparatorDataset> {
  try {
    const enabled = await isEnabled('content.overrides_enabled')
    if (!enabled) return BASELINE

    const overrides = await getOverrides()
    if (overrides.length === 0) return BASELINE

    return applyDatasetOverrides(BASELINE, overrides, locale)
  } catch {
    return BASELINE
  }
}
