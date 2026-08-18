/**
 * Living Shop — the controlled information architecture (epic 07, Sprint 3).
 *
 * Pure and next-free. ONE normalizer, called by the seller UI, the settings
 * route, the Storefront-as-Code importer and the MCP tools (epic D12).
 *
 * Normalization NEVER rejects. A stored config that is missing a key, carries an
 * unknown one, duplicates one, or puts an anchor in the wrong place resolves to
 * something coherent instead of 500-ing a merchant's homepage. Rejection belongs
 * at the WRITE boundary, where a person is there to read the reason; a render is
 * not the place to argue with data that already exists.
 */

import {
  ALL_SECTIONS,
  REQUIRED_SECTIONS,
  OPTIONAL_SECTIONS,
  type SectionConfig,
  type SectionKey,
  type SectionAvailability,
  type SectionNavEntry,
} from './types'

const KNOWN = new Set<string>(ALL_SECTIONS)

function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === 'string' && KNOWN.has(v)
}

/** The shape a brand-new shop gets: everything in its canonical order, nothing hidden. */
export function defaultSectionConfig(): SectionConfig {
  return { order: [...ALL_SECTIONS], hidden: [] }
}

/**
 * Turn whatever is persisted into a coherent config.
 *
 * The invariants it guarantees, in order:
 *   1. anchors lead, in their canonical order — Wall then Shop, always;
 *   2. the order is a PERMUTATION of the known keys: no duplicates, no unknowns,
 *      and nothing missing (a key absent from a stored order is appended in its
 *      canonical position rather than silently dropped, so a section added by a
 *      later release does not vanish from every existing shop);
 *   3. an anchor is never hidden.
 */
export function normalizeSections(raw: unknown): SectionConfig {
  const source = (raw ?? {}) as { order?: unknown; hidden?: unknown }

  const requested = Array.isArray(source.order) ? source.order.filter(isSectionKey) : []
  const seen = new Set<SectionKey>()
  const optionalOrder: SectionKey[] = []
  for (const key of requested) {
    // Anchors are positioned by rule, not by the stored order — a config that
    // asked for Shop before Wall must not be able to move the homepage.
    if (REQUIRED_SECTIONS.includes(key) || seen.has(key)) continue
    seen.add(key)
    optionalOrder.push(key)
  }
  // Anything the stored order never mentioned keeps its canonical position at the
  // end. This is what makes a NEW section appear for existing shops instead of
  // being dropped by an order written before it existed.
  for (const key of OPTIONAL_SECTIONS) {
    if (!seen.has(key)) optionalOrder.push(key)
  }

  const hidden = (Array.isArray(source.hidden) ? source.hidden.filter(isSectionKey) : [])
    .filter((key) => !REQUIRED_SECTIONS.includes(key))

  return {
    order: [...REQUIRED_SECTIONS, ...optionalOrder],
    hidden: [...new Set(hidden)],
  }
}

/**
 * The nav a visitor actually sees.
 *
 * A section renders only when the seller has NOT hidden it AND there is
 * something behind it. Those are two different facts and both must hold — which
 * is precisely how "a hidden section does not create a dead nav link" and "an
 * empty section does not either" become the same rule instead of two forgettable
 * ones.
 */
export function navSections(
  config: SectionConfig,
  availability: SectionAvailability,
): SectionKey[] {
  const hidden = new Set(config.hidden)
  return config.order.filter((key) => {
    if (REQUIRED_SECTIONS.includes(key)) return true
    if (hidden.has(key)) return false
    return availability[key as keyof SectionAvailability] === true
  })
}

/**
 * Route for one section on a given channel.
 *
 * `basePath` is `''` on an owned host and `/mx/s/<slug>` on the marketplace, so
 * every href here is correct on all three channels with no per-channel branch —
 * which is the whole reason the caller resolves the base once and passes it in.
 */
export function sectionPath(key: SectionKey, basePath: string): string {
  switch (key) {
    case 'wall':        return basePath || '/'
    case 'shop':        return `${basePath}/tienda`
    case 'collections': return `${basePath}/colecciones`
    case 'events':      return `${basePath}/eventos`
    case 'about':       return `${basePath}/acerca`
    case 'faq':         return `${basePath}/faq`
    case 'policies':    return `${basePath}/politicas`
  }
}

export function navEntries(
  config: SectionConfig,
  availability: SectionAvailability,
  basePath: string,
): SectionNavEntry[] {
  return navSections(config, availability).map((key) => ({ key, path: sectionPath(key, basePath) }))
}

/**
 * Validate a seller-supplied config at the WRITE boundary.
 *
 * Unlike `normalizeSections`, this one REFUSES — the seller is present and an
 * unknown key is far more likely to be a typo worth surfacing than data worth
 * silently discarding. Both paths agree on what is legal; they disagree only on
 * what to do about illegal input, which is the correct place for them to differ.
 */
export function validateSectionConfig(raw: unknown): { ok: true; value: SectionConfig } | { ok: false; issues: string[] } {
  const issues: string[] = []
  const source = (raw ?? {}) as { order?: unknown; hidden?: unknown }

  if (source.order !== undefined && !Array.isArray(source.order)) {
    issues.push('sections.order debe ser una lista.')
  }
  if (source.hidden !== undefined && !Array.isArray(source.hidden)) {
    issues.push('sections.hidden debe ser una lista.')
  }
  for (const key of Array.isArray(source.order) ? source.order : []) {
    if (!isSectionKey(key)) issues.push(`sections.order: "${String(key)}" no es una sección válida.`)
  }
  for (const key of Array.isArray(source.hidden) ? source.hidden : []) {
    if (!isSectionKey(key)) issues.push(`sections.hidden: "${String(key)}" no es una sección válida.`)
    else if (REQUIRED_SECTIONS.includes(key)) issues.push(`La sección "${key}" no se puede ocultar.`)
  }
  const orderKeys = (Array.isArray(source.order) ? source.order : []).filter(isSectionKey)
  if (new Set(orderKeys).size !== orderKeys.length) issues.push('sections.order tiene secciones repetidas.')

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: normalizeSections(raw) }
}
