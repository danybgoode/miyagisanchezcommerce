/**
 * lib/ml-publish.ts
 *
 * Pure, dependency-free decision seam for Mercado Libre publish (epic 03 ·
 * mercadolibre-sync, Sprint 3). The backend module owns the ML writes + payload
 * build (AGENTS rule #1); this seam owns the UI-facing decisions the publish
 * surface needs: the category-predictor choice (US-9) and the button/state view
 * derived from the linkage (US-7/US-8).
 *
 * No next/* and no network imports — the Playwright `api` runner unit-tests it.
 */

/** A ranked ML category candidate from the backend predictor (mirror of MlCategoryCandidate). */
export type MlCategoryCandidate = {
  category_id: string
  category_name: string
  score: number // 0..1 prediction confidence
}

/**
 * Below this confidence the predictor must NOT auto-pick a category — the UI
 * surfaces the choice to the seller instead of silently guessing (US-9 acceptance).
 */
export const ML_CATEGORY_CONFIDENCE_THRESHOLD = 0.5

export type CategoryChoice = {
  /** The category to publish with, or null when the seller must still choose. */
  categoryId: string | null
  /** Where the choice came from. */
  source: 'override' | 'predicted' | 'none'
  /** True ⇒ the UI must make the seller pick before publishing (no silent guess). */
  needsChoice: boolean
  /** A non-binding pre-fill for the override select when a choice is required. */
  suggestion: string | null
}

/**
 * Decide the ML category for a publish (US-9):
 *  - a seller override always wins (no choice needed),
 *  - else a high-confidence top prediction is used automatically,
 *  - else the seller must choose — we pre-fill with the imported ML category
 *    (Sprint 2 provenance) or the top candidate, but never auto-publish it.
 */
export function pickCategory(
  candidates: MlCategoryCandidate[],
  opts: { override?: string | null; importedMlCategoryId?: string | null; threshold?: number } = {},
): CategoryChoice {
  const override = (opts.override ?? '').trim()
  if (override) {
    return { categoryId: override, source: 'override', needsChoice: false, suggestion: override }
  }
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c.category_id === 'string' && c.category_id.length > 0)
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const top = ranked[0] ?? null
  const threshold = opts.threshold ?? ML_CATEGORY_CONFIDENCE_THRESHOLD
  const imported = (opts.importedMlCategoryId ?? '').trim() || null

  if (top && (top.score ?? 0) >= threshold) {
    return { categoryId: top.category_id, source: 'predicted', needsChoice: false, suggestion: top.category_id }
  }
  return { categoryId: null, source: 'none', needsChoice: true, suggestion: imported ?? top?.category_id ?? null }
}

/** The ML publish state stored on the linkage metadata (mirror of the backend write). */
export type MlLinkView = {
  ml_item_id: string
  ml_status: string | null
  permalink: string | null
  ml_category_id: string | null
  last_synced_at: string | null
} | null

/** The UI-facing publish state derived from the linkage (US-7/US-8). */
export type MlPublishView = {
  linked: boolean
  mlStatus: string | null
  permalink: string | null
  /** es-MX label for the primary action. */
  actionLabel: string
}

/** Derive the publish button label + state from the linkage. es-MX. */
export function mlPublishView(link: MlLinkView): MlPublishView {
  if (!link) {
    return { linked: false, mlStatus: null, permalink: null, actionLabel: 'Publicar en Mercado Libre' }
  }
  const closed = link.ml_status === 'closed'
  return {
    linked: true,
    mlStatus: link.ml_status,
    permalink: link.permalink,
    actionLabel: closed ? 'Reabrir en Mercado Libre' : 'Sincronizar con Mercado Libre',
  }
}
