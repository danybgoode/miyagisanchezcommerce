/**
 * URL helpers — pure, next-free, dependency-free (so they're unit-testable in the
 * Playwright `api` gate without dragging a DB/cache import into the runner).
 */

/**
 * Ensure a user-typed URL carries an explicit scheme.
 *
 * Sellers type scheduling links like `cal.com/refacciones/visita` with no
 * `http(s)://`; rendered as an `href` that resolves to a broken *same-origin
 * relative* link (`miyagisanchez.com/l/...cal.com...`) instead of the real
 * calendar. Prepend `https://` when no scheme is present.
 *
 * Unlike `lib/supply.ts` `canonicalSourceUrl`, this preserves the path/query —
 * a booking link's path is meaningful and must not be stripped.
 *
 * @returns the scheme-qualified URL, or `null` for empty/whitespace input
 *   (so callers fall back cleanly to "no link").
 */
export function ensureUrlProtocol(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  return raw.startsWith('http') ? raw : `https://${raw}`
}
