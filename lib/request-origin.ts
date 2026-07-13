/**
 * Request-origin resolution — pure, next-free, dependency-free (unit-testable
 * in the Playwright `api` gate, same convention as `lib/url.ts`).
 *
 * Every route that builds a redirect/callback URL for a money or OAuth flow
 * (Stripe Checkout/Connect/subscriptions/billing-portal, MercadoPago
 * connect/subscriptions) used to inline the same fallback:
 *   `process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}``
 * duplicated across 10+ files. `NEXT_PUBLIC_SITE_URL` is read here as an
 * ordinary **server-side runtime env var** (not the client-bundle
 * build-time-inlining bug fixed in #244/#245 — that only affects `'use
 * client'` code) — so when it's unset, the Host-header fallback is the only
 * signal left, and Host headers are untrustworthy behind a bare Docker
 * `-p PORT:PORT` run with no explicit hostname config (Cloud Run's own
 * reverse proxy forwards a correct Host in normal operation — this fallback
 * is a local/misconfigured-environment risk, not a known prod exposure).
 *
 * A wrong redirect URL on a MONEY path (a Stripe Connect return_url, a
 * checkout success_url) is a worse failure than a loud, explicit error — so
 * this throws rather than silently building a broken URL when both the env
 * var and the Host header look wrong.
 */

const OBVIOUSLY_WRONG_HOSTS = new Set(['0.0.0.0', 'undefined', 'null', ''])

/** True when a would-be Host value is unusable for a public-facing redirect URL. */
export function isUsableHost(host: string | null | undefined): boolean {
  if (!host) return false
  const hostname = host.split(':')[0].trim().toLowerCase()
  return !OBVIOUSLY_WRONG_HOSTS.has(hostname)
}

export interface ResolveOriginInput {
  /** `process.env.NEXT_PUBLIC_SITE_URL` (or an explicit override in tests). */
  siteUrl?: string | null
  /** The incoming request's `Host` header (`req.headers.get('host')`). */
  host?: string | null
}

/**
 * Resolve the origin to build a redirect/callback URL from. Prefers
 * `NEXT_PUBLIC_SITE_URL`; falls back to the request's `Host` header ONLY
 * when it looks like a real, public-facing value. Throws — rather than
 * silently returning a broken origin — when neither is usable, so a
 * misconfigured environment fails loudly at the point of use instead of
 * quietly minting a dead OAuth/checkout redirect URL.
 */
export function resolveOrigin(input: ResolveOriginInput): string {
  const siteUrl = input.siteUrl?.trim()
  if (siteUrl) return siteUrl.replace(/\/+$/, '')

  if (isUsableHost(input.host)) {
    return `https://${input.host}`
  }

  throw new Error(
    'Cannot resolve a public origin for this request: NEXT_PUBLIC_SITE_URL is unset and the ' +
      `Host header ("${input.host ?? ''}") is not usable. Set NEXT_PUBLIC_SITE_URL in this ` +
      'environment (e.g. a local Docker run needs it passed as a runtime env var, not just ' +
      'baked into .env.local, which only next dev/next start read automatically).',
  )
}
