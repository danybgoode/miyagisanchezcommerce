/**
 * lib/copy-overrides-labels.ts
 *
 * Pure key-path -> human label derivation for `/admin/contenido` (epic 08 ·
 * cms-contenido-restore-and-polish, Story 3.1). Grooming explicitly dropped a
 * hand-curated label map (1,121 keys) in favor of deriving a label from the
 * key path itself — the original es-MX value always renders alongside it for
 * context, so a derived label only needs to orient, not translate. Kept
 * next-free so it's both client-importable and Playwright-loadable.
 */

/** Split on camelCase, digit, `_`/`-` boundaries into lowercase words. */
function splitWords(segment: string): string[] {
  return segment
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
}

function titleCase(words: string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

/**
 * Derives a readable label from a dot-path key. Drops the leading segment
 * (the "section" — already shown as page context by the nav/header) when the
 * key has 2+ segments, so `autos.heroTitle` -> "Hero Title", not
 * "Autos Hero Title". A single-segment key (e.g. `title`) keeps its only
 * segment.
 */
export function humanizeKeyPath(key: string): string {
  const segments = key.split('.').filter(Boolean)
  const rest = segments.length > 1 ? segments.slice(1) : segments
  const words = rest.flatMap(splitWords)
  return titleCase(words)
}

/**
 * A small, bounded set of section keys (Sprint 4) that read as raw English
 * words in an es-MX admin surface and repeat identically across multiple
 * namespaces (`seller`/`public`/`email` on both `sweepstakes` and `events`)
 * — worth curating directly, unlike the 1,121-key field-label map grooming
 * already declined to hand-curate. Anything not listed here falls through to
 * the same word-splitting humanizer `humanizeKeyPath` uses, so a brand-new
 * namespace/section stays covered with zero code changes.
 */
const SECTION_LABEL_OVERRIDES: Record<string, string> = {
  seller: 'Panel de tienda',
  public: 'Público',
  email: 'Correos',
  toggle: 'Interruptor',
  shared: 'Compartido',
}

/**
 * Derives a readable label for a SECTION key itself (the page-nav's item
 * text — distinct from `humanizeKeyPath`, which labels an individual FIELD
 * within an already-selected section).
 */
export function humanizeSectionName(section: string): string {
  return SECTION_LABEL_OVERRIDES[section] ?? titleCase(splitWords(section))
}
