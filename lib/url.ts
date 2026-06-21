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
 * Unlike `canonicalSourceUrl` (below), this preserves the path/query —
 * a booking link's path is meaningful and must not be stripped.
 *
 * The scheme test matches `http(s)://` case-insensitively (not a bare
 * `startsWith('http')`, which both misses `HTTPS://…` and false-positives a
 * scheme-less domain that merely starts with "http" — e.g. `httpbin.org` —
 * leaving it protocol-less and broken).
 *
 * @returns the scheme-qualified URL, or `null` for empty/whitespace input
 *   (so callers fall back cleanly to "no link").
 */
export function ensureUrlProtocol(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/**
 * Canonicalize an imported listing's source URL for dedup — lowercase host,
 * strip `www.`/hash/(usually)query/trailing-slash, with MercadoLibre item-id and
 * Google-Maps special cases. Lives here (pure, dependency-free) so both the
 * server import path (`lib/supply.ts`) and the client paste UI (`SupplyClient`)
 * share one implementation instead of re-inlining it.
 *
 * The scheme test matches `http(s)://` case-insensitively for the same reason as
 * `ensureUrlProtocol`: a bare `startsWith('http')` false-positives a scheme-less
 * host that merely starts with "http" (`httpbin.org` → throws in `new URL()` →
 * falls through to the un-canonicalized raw value) and misses uppercase schemes.
 */
export function canonicalSourceUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const raw = value.trim()
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    url.hash = ''
    if (host === 'google.com' || host === 'maps.google.com') {
      url.hostname = host
      return url.toString()
    }
    url.search = ''
    const mlItem = url.pathname.match(/\/(MLM-\d+[^/]*)/i)
    if (host.endsWith('mercadolibre.com.mx') && mlItem) {
      return `${url.protocol}//${host}/${mlItem[1]}`
    }
    return `${url.protocol}//${host}${url.pathname}`.replace(/\/$/, '')
  } catch {
    return raw
  }
}
