/**
 * lib/copy-overrides-export-scope.ts
 *
 * Pure helpers behind the bulk export/import panel's scope dropdowns (epic 08 ·
 * cms-contenido-restore-and-polish, Story 2.2) — replaces free-text
 * namespace/section fields with predefined, always-valid options plus a
 * plain-language "what this will produce" sentence. Kept free of `next/*`/
 * React so it's client-importable with zero server dependency and
 * Playwright-loadable. Mirrors `matchesScope` in `copy-overrides-import.ts`
 * (the route that actually performs the export) so the summary sentence can
 * never drift from what the export button really produces.
 */
import { namespaceLabel, routeForNamespaceSection } from './copy-overrides-routes'

export interface KeyIndexEntry {
  namespace: string
  key: string
}

/** Every namespace present, sorted — the namespace `<select>`'s options. */
export function namespacesInIndex(index: readonly KeyIndexEntry[]): string[] {
  return [...new Set(index.map((e) => e.namespace))].sort()
}

/** Every section (first key-segment) within `namespace`, sorted — the section `<select>`'s options, cascading from the namespace choice. */
export function sectionsForNamespace(index: readonly KeyIndexEntry[], namespace: string): string[] {
  if (!namespace) return []
  const sections = index.filter((e) => e.namespace === namespace).map((e) => e.key.split('.')[0] ?? e.key)
  return [...new Set(sections)].sort()
}

/** How many keys `{namespace, section}` (either/both empty = "any") actually resolves to — mirrors `matchesScope`. */
export function countForScope(index: readonly KeyIndexEntry[], namespace: string, section: string): number {
  return index.filter(
    (e) => (!namespace || e.namespace === namespace) && (!section || e.key.split('.')[0] === section),
  ).length
}

/** Friendly label for a section within a namespace — falls back to the raw section name. */
function sectionLabel(namespace: string, section: string): string {
  return routeForNamespaceSection(namespace, section)?.label ?? section
}

/**
 * Plain es-MX sentence describing exactly what the export buttons will
 * produce for the current `{namespace, section}` selection — the label the
 * admin sees updates live as they change either dropdown.
 */
export function describeExportScope(namespace: string, section: string, count: number): string {
  const keyWord = count === 1 ? 'clave' : 'claves'
  if (!namespace) {
    return `Esto exportará ${count} ${keyWord} de todas las páginas, en el formato que elijas.`
  }
  const page = namespaceLabel(namespace)
  if (!section) {
    return `Esto exportará ${count} ${keyWord} de ${page}, en el formato que elijas.`
  }
  return `Esto exportará ${count} ${keyWord} de ${page} → ${sectionLabel(namespace, section)}, en el formato que elijas.`
}
