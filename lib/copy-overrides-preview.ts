/**
 * lib/copy-overrides-preview.ts
 *
 * Pure "what would this key resolve to" preview (epic 08 ·
 * cms-contenido-restore-and-polish, Story 1.3) — reuses the exact same merge
 * primitives the live read path uses (`copy-overrides-merge.ts`'s
 * `applyCopyOverrides`, `copy-tree.ts`'s `unflattenRows`/`getAtPath`), so the
 * admin editor's before/after preview is provably the SAME resolution logic
 * `getOverriddenDictionary()` reads through in production — not a separate,
 * potentially-diverging string comparison.
 *
 * Builds a minimal single-leaf skeleton via `unflattenRows` (deliberately
 * permissive — see its own header) instead of needing the full compiled
 * dictionary in the caller, so this stays next-free and Playwright-loadable —
 * usable from the 'use client' editor with zero server dependency.
 */
import { applyCopyOverrides, type OverrideRow } from './copy-overrides-merge'
import { getAtPath, unflattenRows } from './copy-tree'

/**
 * Resolve what `candidateValue` would render as at `namespace.key` for
 * `locale`, routed through the real merge seam. Falls back to `candidateValue`
 * itself in the (should-never-happen) case the round-trip doesn't resolve —
 * never throws. A mismatch here (result !== candidateValue) is itself a
 * signal: it means this key's path shape doesn't round-trip cleanly through
 * `setAtPath`/`getAtPath`, which the admin would otherwise only discover after
 * saving and checking the live page.
 */
export function previewOverrideValue(
  namespace: string,
  key: string,
  locale: string,
  defaultValue: string,
  candidateValue: string,
): string {
  const skeleton: Record<string, unknown> = { [namespace]: unflattenRows([{ key, value: defaultValue }]) }
  const overrides: OverrideRow[] = [{ namespace, key, locale, value: candidateValue }]
  const merged = applyCopyOverrides(skeleton, overrides, locale)
  const resolved = getAtPath((merged as Record<string, unknown>)[namespace], key)
  return typeof resolved === 'string' ? resolved : candidateValue
}
