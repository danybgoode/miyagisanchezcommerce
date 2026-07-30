/**
 * lib/platform-host.ts
 *
 * "Is this Host the Miyagi platform itself, or a tenant's own channel?" — one
 * predicate, one list, shared by `middleware.ts` and by every link builder that
 * has to decide whether a URL may carry a market prefix.
 *
 * WHY THIS IS ITS OWN MODULE. Until the market cutover (epic 07 ·
 * market-architecture-foundation, D7/D8) this list lived only inside
 * `middleware.ts`, because middleware was the only place that cared. The cutover
 * adds a second class of caller: an absolute URL emitted into an email, a
 * checkout `cancel_url`, a UCP payload or a print PDF is market-prefixed on the
 * platform host and must stay UNPREFIXED on a tenant domain. Two copies of
 * "which hosts are ours" would drift, and a drifted copy fails in the worst
 * direction — a tenant link carrying `/mx` (`Roadmap/LEARNINGS.md`: a
 * presentation layer must reuse the SAME channel signals the layout already
 * uses, never invent a parallel scope list).
 *
 * PURE and dependency-free (string work only), so `middleware.ts`, a Server
 * Component, a route handler and a Playwright `api` spec can all use it, and so
 * every branch is reachable from a test with no network.
 */

/** Hostnames that are part of the miyagisanchez platform itself. */
export const PLATFORM_HOSTS = [
  'miyagisanchez.com',
  'www.miyagisanchez.com',
  'localhost',
  '127.0.0.1',
  // Cloudflare→ALB→Cloud Run staging hostname (09-platform-infra
  // frontend-vercel-to-cloudrun, S2.2). NOTE: this alone is not sufficient —
  // 'gcp' must ALSO be in lib/subdomain.ts's INFRA_SUBDOMAINS, since
  // shopSlugFromHost() runs BEFORE this check in middleware and would otherwise
  // treat it as a shop-slug lookup first. Both gates are load-bearing (found
  // live: with only one of the two, the request still 404s "Shop not found" —
  // either as an unknown subdomain, or as an unknown custom domain).
  'gcp.miyagisanchez.com',
]

/**
 * True when this Host header belongs to the platform (apex, www, local dev, the
 * Cloud Run/Vercel preview hosts) rather than to a tenant subdomain or custom
 * domain.
 *
 * Deliberately does NOT try to answer "is this a tenant" — a `*.miyagisanchez.com`
 * shop subdomain returns false here, and middleware resolves it earlier via
 * `shopSlugFromHost`. This predicate answers exactly one question and leaves the
 * ordering to the caller.
 */
export function isPlatformHost(hostname: string): boolean {
  if (!hostname) return false
  const host = hostname.trim().toLowerCase()
  if (PLATFORM_HOSTS.some(h => host === h || host.startsWith(h + ':'))) return true
  // Vercel preview / branch URLs
  if (host.endsWith('.vercel.app')) return true
  // Cloud Run's default dark URL (09-platform-infra frontend-vercel-to-cloudrun,
  // S1.3/S1.4) — same reasoning as .vercel.app: a platform-served preview host,
  // not a tenant custom domain, before Cloudflare fronts the real domain (S2+).
  if (host.endsWith('.run.app')) return true
  return false
}

/**
 * The same question, asked of an absolute URL or a bare origin.
 *
 * Returns `false` for anything unparseable. That is the fail-CLOSED direction
 * for the only caller that matters: an unknown origin gets NO market prefix, so
 * the worst case is a link that costs one 308 on the platform host — never a
 * `/mx` path emitted onto a tenant's own domain.
 */
export function isPlatformOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  const raw = origin.trim()
  try {
    return isPlatformHost(new URL(raw.includes('://') ? raw : `https://${raw}`).host)
  } catch {
    return false
  }
}
