/**
 * lib/copy-overrides-page-nav.ts
 *
 * Pure namespace/section -> nav-group derivation for `/admin/contenido`'s
 * page-first sub-navigation (epic 08 · cms-contenido-restore-and-polish,
 * Story 3.1). Buckets the full, UNFILTERED key list the same way the editor
 * used to group rows client-side (`namespace` -> `key.split('.')[0]`
 * "section"), and resolves each section's real route via the existing
 * `routeForNamespaceSection` (Sprint 2) — so the nav is exactly the same
 * grouping that already existed, just exposed as navigation instead of an
 * inline `<details>` accordion. Namespaces and sections both sort
 * alphabetically for a stable, deterministic nav regardless of dictionary
 * key order. Kept next-free so it's both client-importable and
 * Playwright-loadable.
 */
import { namespaceLabel, routeForNamespaceSection, type RouteInfo } from './copy-overrides-routes'

export interface NavSectionEntry {
  section: string
  count: number
  route: RouteInfo | null
}

export interface NavNamespaceGroup {
  namespace: string
  label: string
  count: number
  sections: NavSectionEntry[]
}

interface NavSourceKey {
  namespace: string
  key: string
}

const byStringAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function buildPageNavGroups(keys: readonly NavSourceKey[]): NavNamespaceGroup[] {
  const byNamespace = new Map<string, Map<string, number>>()
  for (const k of keys) {
    const section = k.key.split('.')[0] || k.key
    const bySection = byNamespace.get(k.namespace) ?? new Map<string, number>()
    bySection.set(section, (bySection.get(section) ?? 0) + 1)
    byNamespace.set(k.namespace, bySection)
  }

  return [...byNamespace.entries()]
    .sort(([a], [b]) => byStringAsc(a, b))
    .map(([namespace, bySection]) => {
      const sections: NavSectionEntry[] = [...bySection.entries()]
        .sort(([a], [b]) => byStringAsc(a, b))
        .map(([section, count]) => ({
          section,
          count,
          route: routeForNamespaceSection(namespace, section),
        }))
      return {
        namespace,
        label: namespaceLabel(namespace),
        count: sections.reduce((n, s) => n + s.count, 0),
        sections,
      }
    })
}

/** The deterministic first group/section — used as the default when the URL names no valid selection. */
export function firstNavSelection(groups: readonly NavNamespaceGroup[]): { namespace: string; section: string } {
  const first = groups[0]
  return { namespace: first?.namespace ?? '', section: first?.sections[0]?.section ?? '' }
}

/** Whether `namespace`+`section` names a real group in `groups` (used to validate a URL-supplied selection). */
export function isValidNavSelection(groups: readonly NavNamespaceGroup[], namespace: string, section: string): boolean {
  const group = groups.find((g) => g.namespace === namespace)
  return group ? group.sections.some((s) => s.section === section) : false
}
