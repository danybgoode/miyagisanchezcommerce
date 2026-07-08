/**
 * lib/excerpt.ts
 *
 * Bookshop launchpad — Sprint 2, Story 2.1 ("Lee un adelanto").
 *
 * Pure, next-free seam for the free text excerpt a seller attaches to a digital
 * listing so a reader can taste the work before buying/voting. Text-only by
 * decision (best mobile-data UX — no pdf.js, no binary): the excerpt is stored
 * inline on the product metadata as `metadata.excerpt = { text }`, read straight
 * back on the PDP (getListing passes metadata through) and surfaced on UCP as
 * `has_excerpt`. No JSX / no network / no `next/*` → unit-testable in the `api`
 * gate (`e2e/excerpt.spec.ts`). The write path (`/api/sell/listing/[id]`) and the
 * viewer island import THIS.
 */

/** Hard cap for an excerpt — a generous first-chapter sample while bounding the
 *  metadata blob written onto the product. */
export const EXCERPT_MAX_CHARS = 20000

/** The stored shape. `kind` is implicit text (only mode today); keep the object
 *  form so a future `kind` never breaks the metadata contract. */
export interface Excerpt {
  text: string
}

/** A render/display model — the text plus its length (for a char counter). */
export interface ExcerptModel {
  text: string
  chars: number
}

// Control chars to strip, keeping \t (0x09) and \n (0x0A) so paragraph breaks +
// tabs survive but stray NULs / escape codes don't. Built from a plain-ASCII
// escape string so this source file carries no literal control bytes.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g')

/**
 * Normalize raw seller input into the stored shape, or `null` to clear it.
 * - normalizes CRLF → LF,
 * - strips control chars (except \t and \n),
 * - trims outer whitespace,
 * - caps at EXCERPT_MAX_CHARS,
 * - empty/whitespace-only ⇒ `null` (callers treat as "no excerpt").
 */
export function normalizeExcerpt(raw: string | null | undefined): Excerpt | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHARS, '')
    .trim()
  if (!cleaned) return null
  const text = cleaned.length > EXCERPT_MAX_CHARS ? cleaned.slice(0, EXCERPT_MAX_CHARS) : cleaned
  return { text }
}

/** Read the excerpt off product metadata, if present + valid. */
export function readExcerpt(metadata: Record<string, unknown> | null | undefined): Excerpt | null {
  const raw = (metadata ?? {})['excerpt']
  if (!raw || typeof raw !== 'object') return null
  const text = (raw as Record<string, unknown>).text
  if (typeof text !== 'string' || !text.trim()) return null
  return { text }
}

/** True when the listing carries a readable excerpt (the UCP `has_excerpt`,
 *  the PDP gate, and the "Adelanto" badge all read this one predicate). */
export function hasExcerpt(metadata: Record<string, unknown> | null | undefined): boolean {
  return readExcerpt(metadata) !== null
}

/** The display model for the viewer/editor, or null when absent. */
export function excerptModel(metadata: Record<string, unknown> | null | undefined): ExcerptModel | null {
  const ex = readExcerpt(metadata)
  return ex ? { text: ex.text, chars: ex.text.length } : null
}
