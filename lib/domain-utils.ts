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

// Sprint 4 (frontend-vercel-to-cloudrun) provider swap: Vercel → Cloudflare for SaaS
// custom hostnames. `cname.miyagisanchez.com` is the fallback-origin hostname
// (infra/gcp/cloudflare-saas-fallback-provision.mjs) — a PROXIED record inside our
// own zone that Cloudflare's edge routes tenant custom-hostname traffic through.
//
// Unlike Vercel, Cloudflare for SaaS does not publish a fixed customer-facing
// anycast IP for apex (A-record) pointing — its documented guidance for apex
// domains is CNAME flattening (ALIAS/ANAME) to the same fallback-origin target
// most registrars support this today. So `dnsRecordFor` now recommends a CNAME
// for BOTH apex and subdomain domains (only `isApex` still distinguishes them,
// for UI copy — "your registrar needs to support a root CNAME/ALIAS"). This
// retires the old A-record path entirely; there is no Cloudflare equivalent of
// `APEX_A_RECORD` to fall back to.

/** CNAME target every domain (apex or subdomain) must point to. */
export const CNAME_TARGET = 'cname.miyagisanchez.com'

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
 * The single DNS record a seller should add for their domain — a CNAME to
 * `cname.miyagisanchez.com`, for apex AND subdomain domains alike:
 *  - apex → CNAME at `@` (needs the registrar's CNAME-flattening/ALIAS/ANAME
 *    support — most modern registrars have this; `isApex` tells the UI to
 *    show that caveat);
 *  - subdomain → a plain CNAME on the sub-label, universally supported.
 */
export function dnsRecordFor(domain: string): {
  host: string
  type: 'A' | 'CNAME'
  value: string
  isApex: boolean
} {
  const d = clean(domain)
  if (isApexDomain(d)) {
    return { host: '@', type: 'CNAME', value: CNAME_TARGET, isApex: true }
  }
  const apex = apexOf(d)
  const host = d.slice(0, Math.max(0, d.length - apex.length - 1)) // strip ".<apex>"
  return { host: host || '@', type: 'CNAME', value: CNAME_TARGET, isApex: false }
}
