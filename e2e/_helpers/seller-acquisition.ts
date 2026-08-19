/**
 * Every persona CTA converts on `/sign-up` and carries the eventual `/sell`
 * destination inside `redirect_url` (see lib/seller-acquisition.ts). Browser
 * specs assert against the live click target the same way the deterministic
 * spec (e2e/seller-acquisition.spec.ts) asserts against the pure builder.
 *
 * Returns null when the visited URL isn't the sign-up hop at all, so a caller
 * can fold the null check into one boolean expression inside `toHaveURL`.
 */
export function resolvedSellTarget(url: URL): URL | null {
  if (url.pathname !== '/sign-up') {
    return null
  }

  const redirectUrl = url.searchParams.get('redirect_url')
  if (!redirectUrl) {
    return null
  }

  return new URL(decodeURIComponent(redirectUrl), url.origin)
}
