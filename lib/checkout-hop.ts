/**
 * lib/checkout-hop.ts
 *
 * Pragmatic checkout hop for the "own channel" (custom-domain storefronts).
 *
 * A buyer browsing a seller's custom domain (mitienda.mx) can't sign in or pay
 * there — Clerk auth is bound to the platform domain (satellite domains were
 * deferred). So the buy / sign-in CTAs route the buyer to the PLATFORM for the
 * secure step, carrying `origin=<their domain>` so a later sprint can return
 * them to the custom domain after payment.
 *
 * On the marketplace / platform these helpers are NO-OPs — they return the same
 * relative paths the CTAs used before, so platform behaviour is unchanged.
 *
 * Client-safe: no server-only imports (used in both Server and Client Components).
 */

const PLATFORM_URL = 'https://miyagisanchez.com'

const PLATFORM_HOSTS = [
  'miyagisanchez.com',
  'www.miyagisanchez.com',
  'localhost',
  '127.0.0.1',
]

/** True for the platform's own hosts (incl. Vercel previews). */
export function isPlatformHost(hostname: string): boolean {
  const h = hostname.split(':')[0].toLowerCase()
  if (PLATFORM_HOSTS.includes(h)) return true
  if (h.endsWith('.vercel.app')) return true
  return false
}

/** The tenant custom domain we're currently on, or null on the platform. */
export function currentCustomDomain(hostname: string | null | undefined): string | null {
  if (!hostname) return null
  const h = hostname.split(':')[0].toLowerCase()
  return isPlatformHost(h) ? null : h
}

/** Append `origin=<domain>` to a path when on a custom domain (else unchanged). */
function withOrigin(path: string, customDomain: string | null): string {
  if (!customDomain) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}origin=${encodeURIComponent(customDomain)}`
}

/**
 * A checkout (or other platform) destination: a relative path on the platform,
 * or an ABSOLUTE platform URL carrying `origin` on a custom domain.
 */
export function checkoutHopHref(path: string, customDomain: string | null): string {
  const p = withOrigin(path, customDomain)
  return customDomain ? `${PLATFORM_URL}${p}` : p
}

/**
 * A sign-in URL that lands the buyer on `afterPath` once authenticated. On the
 * platform this is the unchanged `/sign-in?redirect_url=<afterPath>`. On a custom
 * domain the whole sign-in + the post-login destination live on the platform,
 * with `origin` carried through so checkout can return to the tenant domain.
 */
export function signInHopHref(afterPath: string, customDomain: string | null): string {
  const dest = withOrigin(afterPath, customDomain)
  const signIn = `/sign-in?redirect_url=${encodeURIComponent(dest)}`
  return customDomain ? `${PLATFORM_URL}${signIn}` : signIn
}
