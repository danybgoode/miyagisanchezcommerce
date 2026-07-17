/**
 * lib/slug.ts
 *
 * Shared, dependency-free helpers for the seller-chosen shop slug
 * (`miyagisanchez.com/s/[slug]`). Used by the slug field at shop creation, the
 * slug editor in settings, and the availability API.
 *
 * The slug is authoritative in Medusa (`seller.slug`, unique). These rules MUST
 * stay in sync with the backend guard in
 * `apps/backend/src/api/store/sellers/me/route.ts` (validateSlug / RESERVED_SLUGS).
 */

export const SLUG_MIN = 3
export const SLUG_MAX = 40

/**
 * Slugs the platform can't give away — system routes and high-risk words.
 * Keep in sync with the backend RESERVED_SLUGS.
 */
export const RESERVED_SLUGS = new Set<string>([
  'admin', 'api', 'app', 'sell', 'search', 'orders', 'inbox', 'profile', 'perfil',
  'ayuda', 'help', 's', 'shop', 'www', 'billing', 'support', 'soporte', 'account',
  'cuenta', 'sign-in', 'sign-up', 'embed', 'l', 'messages', 'mensajes', 'checkout',
  'cart', 'carrito', 'settings', 'ajustes', 'supply', 'terminos', 'mschz',
])

/**
 * Turn arbitrary text (e.g. a shop name) into a slug candidate:
 * lowercase, accents stripped, non-alphanumerics → hyphens, trimmed, capped.
 * "Mi Tienda Bonita" → "mi-tienda-bonita".
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
}

export type PreviousSlug = { slug: string; until: string }

/**
 * Pure decision for the old-slug → new-slug 301 (US-4): given a shop's current
 * slug + its alias history, what should a request for `requested` redirect to?
 * Returns the current slug if `requested` is a non-expired alias that isn't
 * already the current slug, else null. Kept here (pure, no next/cache) so it's
 * unit-testable; the DB-backed cached wrapper lives in lib/slug-redirect.ts.
 */
export function pickAliasTarget(
  currentSlug: string,
  previousSlugs: PreviousSlug[],
  requested: string,
  now: number = Date.now(),
): string | null {
  const s = requested.trim().toLowerCase()
  const current = currentSlug.trim().toLowerCase()
  if (!s || s === current) return null
  const entry = previousSlugs.find(p => p?.slug?.toLowerCase() === s)
  if (!entry) return null
  if (new Date(entry.until).getTime() <= now) return null // expired
  return current
}

export const SLUG_ALIAS_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const MAX_PREVIOUS_SLUGS = 10

/**
 * Pure builder for the alias history a slug change leaves behind (US-4): keep
 * non-expired entries, drop any equal to the new slug (it's live again), add
 * the old slug with a fresh 90-day TTL, cap the list. Extracted verbatim from
 * the portal PATCH (app/api/sell/shop/slug) so the MCP `set_shop_slug` tool
 * shares the exact same computation (mcp-parity-config S2.1).
 */
export function buildSlugAliasHistory(
  metadata: Record<string, unknown> | null,
  oldSlug: string,
  newSlug: string,
  now: number = Date.now(),
): { previousSlugs: PreviousSlug[]; previousSlugKeys: string[] } {
  const meta = metadata ?? {}
  const existing = (Array.isArray(meta.previous_slugs) ? meta.previous_slugs : []) as PreviousSlug[]
  const kept = existing.filter(p => p?.slug && p.slug !== newSlug && new Date(p.until).getTime() > now)
  const previousSlugs: PreviousSlug[] = [
    ...kept,
    { slug: oldSlug, until: new Date(now + SLUG_ALIAS_TTL_MS).toISOString() },
  ].slice(-MAX_PREVIOUS_SLUGS)
  return { previousSlugs, previousSlugKeys: previousSlugs.map(p => p.slug) }
}

export type SlugValidation = { valid: true } | { valid: false; reason: string }

/**
 * Validate a candidate slug against the format + reserved rules.
 * Format: 3–40 chars, lowercase alphanumeric + hyphens, no leading/trailing
 * hyphen, no consecutive constraints beyond the regex, not reserved.
 */
export function validateSlug(slug: string): SlugValidation {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return { valid: false, reason: `Usa entre ${SLUG_MIN} y ${SLUG_MAX} caracteres.` }
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return { valid: false, reason: 'Solo minúsculas, números y guiones; sin guion al inicio o al final.' }
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { valid: false, reason: 'Ese slug está reservado. Elige otro.' }
  }
  return { valid: true }
}
