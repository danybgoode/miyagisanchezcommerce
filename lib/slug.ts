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
