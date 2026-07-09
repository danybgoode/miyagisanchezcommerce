/**
 * lib/copy-overrides-merge.ts
 *
 * The PURE merge seam (epic 08 · admin-content-and-announcements, Sprint 1) that
 * layers `platform_copy_overrides` rows onto a compile-time `Dictionary`. Kept free
 * of `next/*` and `server-only` — like `lib/flags-cache.ts` — so it's unit-testable
 * with zero network. `resolveOverriddenDictionary` also lives here (not in the
 * `server-only` `lib/copy-overrides.ts`) for the same reason `resolveFlag` lives in
 * `flags-cache.ts` rather than `flags.ts`: a `server-only`-tagged module throws on
 * import outside a Next server bundle, so the Playwright `api` runner can never load
 * it directly — the injectable-deps core has to live in the `server-only`-free half.
 * `lib/copy-overrides.ts` composes this function, binding the real Supabase/flags/
 * dictionary dependencies (mirrors the flags.ts / flags-cache.ts split).
 *
 * `Dictionary` is imported TYPE-ONLY (erased at runtime): `lib/dictionary.ts` itself
 * imports raw `locales/*.json`, and Node's native ESM loader (which the Playwright
 * `api` runner uses) requires an explicit `type: 'json'` import attribute Next's own
 * bundler doesn't need — a real (non-type-only) import here would break under the
 * test runner despite compiling and running fine inside Next. `normalizeLocale` is
 * trivial enough to inline rather than pull in that transitive runtime import.
 */
import { getAtPath, setAtPath } from './copy-tree'
import type { Dictionary } from './dictionary'

function normalizeLocale(input?: string | null): 'es' | 'en' {
  return input === 'en' ? 'en' : 'es'
}

/** One row of the `platform_copy_overrides` table. */
export interface OverrideRow {
  namespace: string
  key: string
  locale: string
  value: string
}

/**
 * Apply every override row matching `locale` onto `dict`. FAIL-OPEN per row: an
 * override whose `namespace.key` doesn't resolve to an existing string leaf in
 * `dict` is silently skipped (the compile-time value wins) — the dictionary
 * defines the universe, an override can never fabricate new shape. Immutable:
 * returns a new object, `dict` is never mutated.
 */
export function applyCopyOverrides<T extends Record<string, unknown>>(
  dict: T,
  overrides: readonly OverrideRow[],
  locale: string,
): T {
  let result = dict
  for (const row of overrides) {
    if (row.locale !== locale) continue
    const namespaceValue = result[row.namespace]
    if (namespaceValue === undefined) continue
    if (getAtPath(namespaceValue, row.key) === undefined) continue

    const nextNamespaceValue = setAtPath(namespaceValue, row.key, row.value)
    if (nextNamespaceValue === namespaceValue) continue
    result = { ...result, [row.namespace]: nextNamespaceValue }
  }
  return result
}

/** Injectable dependencies for `resolveOverriddenDictionary` — see file header. */
export interface OverriddenDictionaryDeps {
  isEnabled: (flag: 'content.overrides_enabled') => Promise<boolean>
  getOverrides: () => Promise<OverrideRow[]>
  getDictionary: (locale?: string | null) => Promise<Dictionary>
}

/**
 * Resolve a dictionary with copy overrides applied. Flag OFF, or no overrides at
 * all (Supabase down, table empty, or nothing edited yet), returns the
 * compile-time `dict` unchanged — never fabricated, never thrown. Pure given pure
 * deps, so this is what the unit specs exercise for the flag-OFF / no-overrides
 * fallback branches without any live Supabase/flags infra.
 */
export async function resolveOverriddenDictionary(
  deps: OverriddenDictionaryDeps,
  locale?: string | null,
): Promise<Dictionary> {
  const dict = await deps.getDictionary(locale)
  const enabled = await deps.isEnabled('content.overrides_enabled')
  if (!enabled) return dict

  const overrides = await deps.getOverrides()
  if (overrides.length === 0) return dict

  return applyCopyOverrides(dict, overrides, normalizeLocale(locale))
}
