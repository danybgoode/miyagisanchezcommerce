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
