/**
 * lib/copy-overrides-import.ts
 *
 * The PURE bulk export/import/diff logic for the runtime copy-override layer
 * (epic 08 · admin-content-and-announcements, Sprint 1). Kept free of `next/*`,
 * `server-only`, `xlsx`, and the raw `locales/*.json` import (mirrors
 * `copy-overrides-merge.ts`'s header — a real JSON import breaks under the
 * Playwright `api` runner's native ESM loader) — so it's unit-testable with zero
 * network/dictionary infra. The `xlsx` (SheetJS) wrapping around
 * `rowsFromSheetJson`/`rowsToSheetJson` lives in the route handlers, which pass
 * plain arrays in/out of this module.
 *
 * CSV parsing mirrors `lib/catalog-import.ts`'s hand-rolled, quote-aware,
 * line-split parser (no CSV dependency in this repo) — same known limitation: a
 * literal newline INSIDE a quoted cell isn't supported (values here are single-
 * line strings in practice, matching the existing catalog importer's shape).
 */
import { flattenDictionary, flattenNamespace, unflattenRows, type FlatCopyEntry } from './copy-tree'
import { isBilingualNamespace } from './bilingual-namespaces'
import type { OverrideRow } from './copy-overrides-merge'
import { sectionForKey } from './copy-overrides-sections'

/** Hard cap per export/import — keeps a single round-trip safe to process and review. */
export const MAX_EXPORT_IMPORT_ROWS = 2000

export interface CopyExportRow {
  namespace: string
  key: string
  locale: 'es' | 'en'
  /** The compile-time value — informational, ignored on import. */
  default: string
  /** The current EFFECTIVE value (override if present, else `default`) — what round-trips. */
  value: string
}

export interface ImportScope {
  namespace?: string
  /** A "section" within a namespace, per the shared `sectionForKey` rule — e.g. `'anchor'`, or a page path for `sellerCopy`. */
  section?: string
}

function matchesScope(entry: FlatCopyEntry, scope: ImportScope): boolean {
  if (scope.namespace && entry.namespace !== scope.namespace) return false
  if (scope.section && sectionForKey(entry.namespace, entry.key) !== scope.section) return false
  return true
}

/** The lookup key `buildDefaultsMap` / `diffImport` use — exported so a caller (e.g. the apply route) can build a matching key without duplicating the format. */
export function overrideKey(namespace: string, key: string, locale: string): string {
  return `${namespace} ${key} ${locale}`
}

/**
 * Build the export row set for a scope: one `es` row per dictionary leaf, plus an
 * `en` row for the same leaf ONLY on a bilingual-allow-listed namespace. `value`
 * is the current EFFECTIVE value (override if present, else the compile-time
 * default) — this is what a copywriter edits externally and what comes back on
 * import; `default` is a read-only reference column, ignored on import.
 */
export function buildExportRows(
  esDict: Record<string, unknown>,
  enDict: Record<string, unknown>,
  overrides: readonly OverrideRow[],
  scope: ImportScope = {},
): CopyExportRow[] {
  const overrideMap = new Map(overrides.map((o) => [overrideKey(o.namespace, o.key, o.locale), o.value]))
  const enFlatByPath = new Map(flattenDictionary(enDict).map((e) => [`${e.namespace}.${e.key}`, e.value]))
  const rows: CopyExportRow[] = []

  for (const entry of flattenDictionary(esDict)) {
    if (!matchesScope(entry, scope)) continue
    const path = `${entry.namespace}.${entry.key}`

    const esOverride = overrideMap.get(overrideKey(entry.namespace, entry.key, 'es'))
    rows.push({ namespace: entry.namespace, key: entry.key, locale: 'es', default: entry.value, value: esOverride ?? entry.value })

    if (isBilingualNamespace(entry.namespace)) {
      const enDefault = enFlatByPath.get(path)
      if (typeof enDefault === 'string') {
        const enOverride = overrideMap.get(overrideKey(entry.namespace, entry.key, 'en'))
        rows.push({ namespace: entry.namespace, key: entry.key, locale: 'en', default: enDefault, value: enOverride ?? enDefault })
      }
    }
  }
  return rows
}

// ── CSV (flattened key paths) ─────────────────────────────────────────────────

const CSV_HEADER = ['namespace', 'key', 'locale', 'default', 'value']

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function rowsToCsv(rows: readonly CopyExportRow[]): string {
  const lines = [CSV_HEADER.join(',')]
  for (const r of rows) {
    lines.push([r.namespace, r.key, r.locale, r.default, r.value].map(csvEscape).join(','))
  }
  return lines.join('\n')
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') { cell += '"'; i++ }
    else if (char === '"') { quoted = !quoted }
    else if (char === ',' && !quoted) { cells.push(cell); cell = '' }
    else { cell += char }
  }
  cells.push(cell)
  return cells
}

/** One imported row, before diffing — the shape every format parses down to. */
export interface ImportedRow {
  namespace: string
  key: string
  locale: string
  value: string
}

/** Parse CSV text (as produced by `rowsToCsv`, or a spreadsheet export of it) into rows. */
export function csvToImportedRows(text: string): ImportedRow[] {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const namespaceIdx = headers.indexOf('namespace')
  const keyIdx = headers.indexOf('key')
  const localeIdx = headers.indexOf('locale')
  const valueIdx = headers.indexOf('value')
  if (namespaceIdx === -1 || keyIdx === -1 || localeIdx === -1 || valueIdx === -1) return []

  return lines.slice(1, 1 + MAX_EXPORT_IMPORT_ROWS).map((line) => {
    const cells = parseCsvLine(line)
    return {
      namespace: cells[namespaceIdx] ?? '',
      key: cells[keyIdx] ?? '',
      locale: cells[localeIdx] ?? '',
      value: cells[valueIdx] ?? '',
    }
  })
}

// ── XLSX (SheetJS row objects — the `xlsx` dependency itself lives in the route) ─

/** `CopyExportRow[]` → the plain row-object shape `XLSX.utils.json_to_sheet` expects. */
export function rowsToSheetJson(rows: readonly CopyExportRow[]): Array<Record<string, string>> {
  return rows.map((r) => ({ namespace: r.namespace, key: r.key, locale: r.locale, default: r.default, value: r.value }))
}

/** The plain row-object shape `XLSX.utils.sheet_to_json` returns → `ImportedRow[]`. */
export function sheetJsonToImportedRows(sheet: readonly Record<string, unknown>[]): ImportedRow[] {
  return sheet.slice(0, MAX_EXPORT_IMPORT_ROWS).map((row) => ({
    namespace: String(row.namespace ?? ''),
    key: String(row.key ?? ''),
    locale: String(row.locale ?? ''),
    value: String(row.value ?? ''),
  }))
}

// ── JSON (structure-true: {namespace: {es: {...tree}, en?: {...tree}}}) ────────

/** `CopyExportRow[]` → `{namespace: {es: <nested tree>, en?: <nested tree>}}`. */
export function rowsToJsonTree(rows: readonly CopyExportRow[]): Record<string, Record<string, unknown>> {
  const byNamespace = new Map<string, { es: Array<{ key: string; value: string }>; en: Array<{ key: string; value: string }> }>()
  for (const r of rows) {
    if (!byNamespace.has(r.namespace)) byNamespace.set(r.namespace, { es: [], en: [] })
    byNamespace.get(r.namespace)![r.locale].push({ key: r.key, value: r.value })
  }
  const tree: Record<string, Record<string, unknown>> = {}
  for (const [namespace, byLocale] of byNamespace) {
    tree[namespace] = { es: unflattenRows(byLocale.es) }
    if (byLocale.en.length > 0) tree[namespace].en = unflattenRows(byLocale.en)
  }
  return tree
}

/** The inverse of `rowsToJsonTree` — parses an uploaded JSON file back into `ImportedRow[]`. */
export function jsonTreeToImportedRows(tree: unknown): ImportedRow[] {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return []
  const rows: ImportedRow[] = []
  for (const [namespace, byLocale] of Object.entries(tree as Record<string, unknown>)) {
    if (!byLocale || typeof byLocale !== 'object' || Array.isArray(byLocale)) continue
    for (const [locale, value] of Object.entries(byLocale as Record<string, unknown>)) {
      for (const entry of flattenNamespace(namespace, value)) {
        rows.push({ namespace: entry.namespace, key: entry.key, locale, value: entry.value })
      }
    }
  }
  return rows.slice(0, MAX_EXPORT_IMPORT_ROWS)
}

// ── Diff preview ────────────────────────────────────────────────────────────────

export type ImportDiffAction = 'added' | 'changed' | 'unchanged' | 'skippedUnknown'

export interface ImportDiffRow {
  namespace: string
  key: string
  locale: string
  action: ImportDiffAction
  /** The current override value, or `null` when none exists (the default was showing). */
  previousValue: string | null
  newValue: string
}

/**
 * Diff imported rows against the current override state. `defaults` is the
 * known-path universe — `${namespace} ${key} ${locale}` → compile-time
 * value — built by the caller from the real dictionary via `buildExportRows`'
 * flatten pattern. An imported `namespace.key.locale` outside `defaults` is
 * `skippedUnknown`: NEVER written, since the dictionary defines the universe.
 * A row whose imported value equals the current EFFECTIVE value (override, or
 * the default if none) is `unchanged` — only a genuine deviation is `added`
 * (no prior override) or `changed` (an override already existed).
 */
export function diffImport(
  importedRows: readonly ImportedRow[],
  currentOverrides: readonly OverrideRow[],
  defaults: ReadonlyMap<string, string>,
): ImportDiffRow[] {
  const overrideMap = new Map(currentOverrides.map((o) => [overrideKey(o.namespace, o.key, o.locale), o.value]))

  return importedRows.map((row) => {
    const mapKey = overrideKey(row.namespace, row.key, row.locale)
    if (!defaults.has(mapKey)) {
      return { namespace: row.namespace, key: row.key, locale: row.locale, action: 'skippedUnknown', previousValue: overrideMap.get(mapKey) ?? null, newValue: row.value }
    }
    const previousValue = overrideMap.get(mapKey) ?? null
    const effective = previousValue ?? defaults.get(mapKey)!
    if (effective === row.value) {
      return { namespace: row.namespace, key: row.key, locale: row.locale, action: 'unchanged', previousValue, newValue: row.value }
    }
    return {
      namespace: row.namespace,
      key: row.key,
      locale: row.locale,
      action: previousValue === null ? 'added' : 'changed',
      previousValue,
      newValue: row.value,
    }
  })
}

/**
 * Build the `defaults` map `diffImport` needs. `es` entries cover every
 * dictionary leaf; `en` entries are included ONLY for a bilingual-allow-listed
 * namespace — an imported `en` row for any other namespace then correctly has
 * no matching default and comes back `skippedUnknown`, enforcing the allow-list
 * at diff time too (defense in depth alongside the single-key write validator).
 */
export function buildDefaultsMap(esDict: Record<string, unknown>, enDict: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of flattenDictionary(esDict)) {
    map.set(overrideKey(e.namespace, e.key, 'es'), e.value)
  }
  for (const e of flattenDictionary(enDict)) {
    if (isBilingualNamespace(e.namespace)) {
      map.set(overrideKey(e.namespace, e.key, 'en'), e.value)
    }
  }
  return map
}
