/**
 * lib/shortlink.ts
 *
 * Pure helpers for the ultra-short branded link domain (mschz.org/[x]). The host
 * 301-redirects a single path segment to the canonical storefront URL — shop slug
 * (or a retired-slug alias) → /s/[slug]; product short-slug/short-code → /l/[id];
 * unknown → branded 404. The actual DB lookups happen in middleware (which can't
 * use unstable_cache); these are the pure, unit-testable bits.
 *
 * We deliberately target the platform canonical paths (`/s/[slug]`, `/l/[id]`) and
 * let those pages do any further custom-domain consolidation — so the short-link
 * layer needs no custom_domain lookup of its own.
 */

export const PLATFORM_ORIGIN = 'https://miyagisanchez.com'

/** Hosts that act as the short-link redirector. */
export const SHORTLINK_HOSTS = ['mschz.org', 'www.mschz.org']

/** True when this Host is the short-link domain (port-tolerant). */
export function isShortLinkHost(host: string | null | undefined): boolean {
  if (!host) return false
  return SHORTLINK_HOSTS.includes(host.split(':')[0].trim().toLowerCase())
}

/**
 * The first path segment, lowercased + URL-decoded (case-insensitive links).
 * Returns null for an empty path ("/", "") so the caller can send those home.
 */
export function firstSegment(pathname: string): string | null {
  const seg = (pathname || '').split('/').filter(Boolean)[0]
  if (!seg) return null
  try { return decodeURIComponent(seg).trim().toLowerCase() } catch { return seg.trim().toLowerCase() }
}

/** Canonical platform target for a shop slug. */
export function shopTarget(slug: string): string {
  return `${PLATFORM_ORIGIN}/s/${slug}`
}

/** Canonical platform target for a listing (Medusa product id). */
export function listingTarget(productId: string): string {
  return `${PLATFORM_ORIGIN}/l/${productId}`
}

/** Where an empty path and an unknown segment go. */
export const HOME_TARGET = PLATFORM_ORIGIN
export const NOT_FOUND_TARGET = `${PLATFORM_ORIGIN}/404`

// Lowercase base36 (no uppercase, so links stay case-insensitive-safe and tidy).
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * A random short code for a listing (default 6 chars of lowercase base36 ≈ 2B
 * combinations). Uniqueness is enforced by the caller (retry on collision).
 */
export function generateShortCode(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}
