/**
 * lib/copy-tree.ts
 *
 * Pure dot-path get/set/flatten over a nested copy object (a locales/*.json
 * namespace, or the whole `Dictionary`). Kept free of `next/*` and `server-only` —
 * like `lib/flags-cache.ts` / `lib/cache-policy.ts` — so it's unit-testable with
 * zero network by the Playwright `api` runner.
 *
 * Namespace values aren't flat: some leaves sit inside arrays (e.g.
 * `sellerAcquisition.anchor.heroStats[0].value`, `promotor.steps[2].title`). Paths
 * use dot-separated segments with a numeric segment for an array index — e.g.
 * `anchor.heroStats.0.value` — so ONE path grammar covers both objects and arrays.
 * This is the single source both the merge seam (`copy-overrides-merge.ts`) and the
 * admin editor / bulk export-import (`copy-overrides-admin.ts`, `copy-overrides-import.ts`)
 * build on, so path handling can't drift between them.
 */

function splitPath(path: string): string[] {
  return path.split('.').filter((seg) => seg.length > 0)
}

function isIndexSegment(segment: string): boolean {
  return /^\d+$/.test(segment)
}

/**
 * Read the value at `path` inside `obj`. Returns `undefined` if any segment along
 * the way doesn't resolve (unknown/mismatched path) — never throws.
 */
export function getAtPath(obj: unknown, path: string): unknown {
  const segments = splitPath(path)
  let cursor: unknown = obj
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined
    if (Array.isArray(cursor)) {
      if (!isIndexSegment(segment)) return undefined
      cursor = cursor[Number(segment)]
      continue
    }
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * Immutably set the STRING value at `path` inside `obj`, returning a new object
 * (deep-cloned along the path only). Returns `obj` unchanged (same reference) if
 * `path` doesn't resolve to an existing leaf, or that leaf isn't currently a
 * string — an override can only replace a string leaf that's actually there,
 * never fabricate new shape (the dictionary defines the universe).
 */
export function setAtPath<T>(obj: T, path: string, value: string): T {
  if (getAtPath(obj, path) === undefined) return obj
  if (typeof getAtPath(obj, path) !== 'string') return obj

  const segments = splitPath(path)

  function recur(node: unknown, depth: number): unknown {
    const segment = segments[depth]
    if (depth === segments.length - 1) {
      if (Array.isArray(node)) {
        const next = node.slice()
        next[Number(segment)] = value
        return next
      }
      return { ...(node as Record<string, unknown>), [segment]: value }
    }
    if (Array.isArray(node)) {
      const next = node.slice()
      next[Number(segment)] = recur(next[Number(segment)], depth + 1)
      return next
    }
    const record = node as Record<string, unknown>
    return { ...record, [segment]: recur(record[segment], depth + 1) }
  }

  return recur(obj, 0) as T
}

/** One flattened string leaf: `namespace` + a dot-path `key` within it + its value. */
export interface FlatCopyEntry {
  namespace: string
  key: string
  value: string
}

/** Flatten every string leaf under `value` into dot-paths, prefixed by `prefix`. */
function flattenValue(value: unknown, prefix: string, out: Array<{ key: string; value: string }>): void {
  if (typeof value === 'string') {
    out.push({ key: prefix, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenValue(item, prefix ? `${prefix}.${i}` : String(i), out))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenValue(v, prefix ? `${prefix}.${k}` : k, out)
    }
  }
  // numbers/booleans/null: not overridable copy — skipped.
}

/** Flatten a single namespace's value into `{namespace, key, value}` entries. */
export function flattenNamespace(namespace: string, value: unknown): FlatCopyEntry[] {
  const out: Array<{ key: string; value: string }> = []
  flattenValue(value, '', out)
  return out.map((e) => ({ namespace, key: e.key, value: e.value }))
}

/** Flatten every namespace of a full dictionary object into `{namespace, key, value}` entries. */
export function flattenDictionary(dict: Record<string, unknown>): FlatCopyEntry[] {
  return Object.entries(dict).flatMap(([namespace, value]) => flattenNamespace(namespace, value))
}

/**
 * The inverse of `flattenValue` — BUILDS a nested object/array structure from a
 * list of dot-path entries, starting from nothing. Unlike `setAtPath` (which
 * refuses to fabricate new shape — the merge seam's "never create" contract),
 * this is deliberately permissive: it's used only for round-tripping a bulk
 * export/import file back into a `{namespace: {locale: {...tree}}}` JSON shape
 * (`lib/copy-overrides-import.ts`), where the SET of paths itself already came
 * from `flattenDictionary` over the real dictionary — the shape is trusted by
 * construction, not being invented from untrusted input.
 */
export function unflattenRows(entries: readonly { key: string; value: string }[]): Record<string, unknown> {
  let result: Record<string, unknown> = {}
  for (const entry of entries) {
    result = setDeepCreate(result, splitPath(entry.key), entry.value) as Record<string, unknown>
  }
  return result
}

function setDeepCreate(node: unknown, segments: readonly string[], value: string): unknown {
  const [segment, ...rest] = segments
  const childIsArray = rest.length > 0 && isIndexSegment(rest[0])

  if (isIndexSegment(segment)) {
    const arr = Array.isArray(node) ? node.slice() : []
    const idx = Number(segment)
    arr[idx] = rest.length === 0 ? value : setDeepCreate(arr[idx] ?? (childIsArray ? [] : {}), rest, value)
    return arr
  }

  const record = (node && typeof node === 'object' && !Array.isArray(node) ? node : {}) as Record<string, unknown>
  return {
    ...record,
    [segment]: rest.length === 0 ? value : setDeepCreate(record[segment] ?? (childIsArray ? [] : {}), rest, value),
  }
}
