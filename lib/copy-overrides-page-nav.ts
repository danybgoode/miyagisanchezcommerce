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
 *
 * Sprint 4: every section gets its own friendly `label` instead of repeating
 * the group's shared page label — the bug Daniel flagged from a screenshot
 * review was every sibling section rendering identical text. A section's
 * OWN route label already differentiates it well when the group isn't
 * uniform (`sellerAcquisition`'s curated "Vende — Autos" style labels,
 * `sweepstakes`/`events`'s new per-surface labels from Story 4.1) — using it
 * there preserves those, and reserves the generic `humanizeSectionName()`
 * word-splitter for the case that actually needs it: a UNIFORM group (`home`,
 * `terms`, …), where every section's route label is identical and therefore
 * useless as a differentiator. `uniformRoute` lets the caller show a shared
 * destination ONCE at the group header instead of per item; `null` when
 * sections genuinely differ, so the caller shows each one's own destination.
 */
import { humanizeSectionName } from './copy-overrides-labels'
import { namespaceLabel, routeForNamespaceSection, type RouteInfo } from './copy-overrides-routes'

export interface NavSectionEntry {
  section: string
  label: string
  count: number
  route: RouteInfo | null
}

export interface NavNamespaceGroup {
  namespace: string
  label: string
  count: number
  sections: NavSectionEntry[]
  /** Set only when every section resolves to the exact same route; `null` when they genuinely differ. */
  uniformRoute: RouteInfo | null
}

interface NavSourceKey {
  namespace: string
  key: string
}

const byStringAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function routesEqual(a: RouteInfo | null, b: RouteInfo | null): boolean {
  if (a === null || b === null) return a === b
  return a.label === b.label && a.path === b.path
}

function computeUniformRoute(sections: readonly { route: RouteInfo | null }[]): RouteInfo | null {
  if (sections.length === 0) return null
  const first = sections[0].route
  return sections.every((s) => routesEqual(s.route, first)) ? first : null
}

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
      const withRoutes = [...bySection.entries()]
        .sort(([a], [b]) => byStringAsc(a, b))
        .map(([section, count]) => ({ section, count, route: routeForNamespaceSection(namespace, section) }))
      const uniformRoute = computeUniformRoute(withRoutes)
      // A uniform group's route label is identical for every section (useless
      // as a differentiator) — humanize the section key instead. A non-uniform
      // group's route label is already a real, curated distinguisher; prefer
      // it, falling back to the humanized section only for a section whose
      // route didn't resolve (a genuinely unrecognized one).
      const sections: NavSectionEntry[] = withRoutes.map((s) => ({
        ...s,
        label: uniformRoute ? humanizeSectionName(s.section) : s.route?.label ?? humanizeSectionName(s.section),
      }))
      return {
        namespace,
        label: namespaceLabel(namespace),
        count: sections.reduce((n, s) => n + s.count, 0),
        sections,
        uniformRoute,
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
