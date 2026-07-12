/**
 * lib/copy-overrides-draft-batch.ts
 *
 * Pure draft-aggregation for `/admin/contenido`'s batched save (epic 08 ·
 * cms-contenido-restore-and-polish, Story 3.2) — turns the editor's dirty-
 * draft map into the exact `rows` shape the EXISTING bulk-apply route
 * (`POST /api/admin/content-overrides/import/apply`) already accepts, so no
 * new backend route is needed. Kept next-free so it's both client-importable
 * and Playwright-loadable.
 */

export interface DraftEntry {
  namespace: string
  key: string
  es?: string
  en?: string
}

export interface BatchApplyRow {
  namespace: string
  key: string
  locale: string
  value: string
}

/** The same `namespace.key` join used as the drafts map's own key — namespaces never contain dots. */
export function draftPathOf(namespace: string, key: string): string {
  return `${namespace}.${key}`
}

/** Flattens every draft entry's set locale(s) into the bulk-apply route's `rows` shape. */
export function buildBatchApplyRows(drafts: Record<string, DraftEntry>): BatchApplyRow[] {
  const rows: BatchApplyRow[] = []
  for (const draft of Object.values(drafts)) {
    if (draft.es !== undefined) rows.push({ namespace: draft.namespace, key: draft.key, locale: 'es', value: draft.es })
    if (draft.en !== undefined) rows.push({ namespace: draft.namespace, key: draft.key, locale: 'en', value: draft.en })
  }
  return rows
}

/**
 * After a batch-apply response, keep pending ONLY the drafts the route
 * rejected — a fully-successful save clears every draft; a partial failure
 * leaves just the failed rows so the admin can see and retry them.
 */
export function removeAppliedDrafts<T extends DraftEntry>(
  drafts: Record<string, T>,
  rejected: ReadonlyArray<{ namespace?: unknown; key?: unknown; [extra: string]: unknown }>,
): Record<string, T> {
  const rejectedPaths = new Set(
    rejected
      .filter((r): r is { namespace: string; key: string } => typeof r.namespace === 'string' && typeof r.key === 'string')
      .map((r) => draftPathOf(r.namespace, r.key)),
  )
  const next: Record<string, T> = {}
  for (const [path, draft] of Object.entries(drafts)) {
    if (rejectedPaths.has(path)) next[path] = draft
  }
  return next
}
