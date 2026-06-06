/**
 * lib/domain-utils.ts
 *
 * Shared, dependency-free helpers for the custom-domain ("own channel") feature.
 * Used by both the seller settings UI and the domain API routes so the notion of
 * "apex vs subdomain" and the DNS record to add stay consistent everywhere.
 *
 * Note: this is a tiny built-in suffix list, not the full Public Suffix List.
 * It covers the cases this marketplace actually sees — Mexico's `.com.mx` family
 * plus a few common global 2-label ccTLDs — so an apex like `tienda.com.mx`
 * isn't mistaken for a subdomain.
 */

// These are generic fallbacks. At runtime the domain route and the Cloudflare
// automation prefer Vercel's *project-specific* recommended records from
// `getDomainConfig()` (lib/vercel-domains.ts) — Vercel now issues per-project
// CNAME targets and the apex IP can change, so the live value is authoritative
// and these constants are only used when that API is unreachable.

/** CNAME target a subdomain must point to (generic fallback). */
export const CNAME_TARGET = 'cname.vercel-dns.com'
/** A-record IP a true apex must point to — Vercel anycast (generic fallback). */
export const APEX_A_RECORD = '76.76.21.21'

// Two-label public suffixes that must be treated as a single TLD.
const MULTI_LABEL_SUFFIXES = [
  'com.mx', 'gob.mx', 'org.mx', 'net.mx', 'edu.mx',
  'co.uk', 'com.ar', 'com.br', 'com.co',
]

function clean(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')
}

/** The registrable apex of a domain, accounting for 2-label ccTLD suffixes. */
export function apexOf(domain: string): string {
  const d = clean(domain)
  const labels = d.split('.').filter(Boolean)
  const suffix = MULTI_LABEL_SUFFIXES.find(s => d === s || d.endsWith('.' + s))
  const tldLabels = suffix ? suffix.split('.').length : 1
  return labels.slice(-(tldLabels + 1)).join('.')
}

/** True when the domain has no subdomain label (e.g. `tienda.mx`, `tienda.com.mx`). */
export function isApexDomain(domain: string): boolean {
  return apexOf(domain) === clean(domain)
}

/**
 * The single DNS record a seller should add for their domain:
 *  - apex → an A record at `@` pointing to Vercel's anycast IP (works on every
 *    registrar, including those that reject a CNAME at the root);
 *  - subdomain → a CNAME on the sub-label pointing to `cname.vercel-dns.com`.
 */
export function dnsRecordFor(domain: string): {
  host: string
  type: 'A' | 'CNAME'
  value: string
  isApex: boolean
} {
  const d = clean(domain)
  if (isApexDomain(d)) {
    return { host: '@', type: 'A', value: APEX_A_RECORD, isApex: true }
  }
  const apex = apexOf(d)
  const host = d.slice(0, Math.max(0, d.length - apex.length - 1)) // strip ".<apex>"
  return { host: host || '@', type: 'CNAME', value: CNAME_TARGET, isApex: false }
}
