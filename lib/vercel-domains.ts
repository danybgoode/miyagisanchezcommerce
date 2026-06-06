/**
 * lib/vercel-domains.ts
 *
 * Programmatic Vercel domain management for the "own channel" feature.
 * Adds / verifies / removes custom domains from the Vercel project so
 * that tenant domains (e.g. myshop.mx) resolve to the miyagisanchez
 * deployment with automatic SSL.
 *
 * Reads VERCEL_API_TOKEN and VERCEL_PROJECT_ID from env.
 * Server-only — never import in client components.
 */

import { CNAME_TARGET } from './domain-utils'

const API = 'https://api.vercel.com'

/**
 * Thrown when the domain is already registered to a *different* Vercel
 * account/project (not this one) — i.e. it's genuinely taken elsewhere.
 * The route maps this to a friendly 409 rather than a generic 502.
 */
export class DomainConflictError extends Error {
  constructor(public detail: string) {
    super('domain_conflict')
    this.name = 'DomainConflictError'
  }
}

function headers() {
  const token = process.env.VERCEL_API_TOKEN
  if (!token) throw new Error('VERCEL_API_TOKEN is not set')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function projectId() {
  const id = process.env.VERCEL_PROJECT_ID
  if (!id) throw new Error('VERCEL_PROJECT_ID is not set')
  return id
}

// ── Types ────────────────────────────────────────────────────────────────────

export type VercelDomainStatus = {
  /** Whether Vercel has verified SSL and DNS for this domain */
  verified: boolean
  /** The CNAME value the tenant must point their domain to */
  cname_target: string
  /** Current apexName as Vercel sees it */
  apex_name: string | null
  /** Vercel's verification challenges (if domain not yet verified) */
  verification: Array<{ type: string; domain: string; value: string; reason: string }>
  error: string | null
}

/**
 * Vercel's live view of how a domain's DNS is actually configured — the
 * authoritative source for "does this point at us and can we issue a cert?".
 * Returned by GET /v6/domains/{domain}/config. Immune to per-project CNAME /
 * apex-IP drift and to Cloudflare CNAME-flattening, which a raw `dns.resolve*`
 * check is not.
 */
export type VercelDomainConfig = {
  /** false = configured AND a TLS cert can be issued (i.e. genuinely live). */
  misconfigured: boolean
  /**
   * How Vercel currently sees the domain resolving:
   *  - 'A' / 'CNAME' — pointing at us correctly
   *  - 'http'        — resolves to us but behind a proxy (e.g. Cloudflare's
   *                    "orange cloud") → cert issuance blocked
   *  - 'dns-01'/null — not resolving to us yet
   */
  configuredBy: 'A' | 'CNAME' | 'http' | 'dns-01' | null
  /** Project-specific recommended apex A-record IPs (rank 1 first). */
  recommendedIPv4: string[]
  /** Project-specific recommended subdomain CNAME target (rank 1). */
  recommendedCNAME: string | null
}

// ── addDomainToProject ───────────────────────────────────────────────────────

/**
 * Register a custom domain on the Vercel project.
 * Must be called server-side when the tenant saves their domain in settings.
 * Returns the required CNAME target and initial verification state.
 */
export async function addDomainToProject(domain: string): Promise<VercelDomainStatus> {
  const res = await fetch(
    `${API}/v10/projects/${projectId()}/domains`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: domain }),
    }
  )
  const data = await res.json() as Record<string, unknown>

  if (!res.ok) {
    const error = data.error as Record<string, unknown> | undefined
    const code = error?.code as string | undefined
    const message = (error?.message as string | undefined) ?? `Vercel API error ${res.status}`

    // `domain_already_in_use` can mean two very different things:
    //  (a) it's already on THIS project → harmless, just read its status;
    //  (b) it's on ANOTHER project/account → genuinely taken (getDomainStatus
    //      will 404 on our project, surfacing it as a conflict).
    if (code === 'domain_already_in_use') {
      try {
        return await getDomainStatus(domain)
      } catch {
        throw new DomainConflictError(message)
      }
    }
    // Domain owned by another Vercel team/account we can't touch.
    if (code === 'forbidden' || code === 'domain_taken') {
      throw new DomainConflictError(message)
    }
    throw new Error(message)
  }

  return normalizeDomainResponse(data)
}

// ── registerShopSubdomain ────────────────────────────────────────────────────

/**
 * Register `<slug>.miyagisanchez.com` on the Vercel project so Vercel serves it
 * with a per-host TLS cert (issued once DNS resolves via the GoDaddy `*` CNAME).
 * Every shop's slug doubles as a free subdomain (the subdomains epic).
 *
 * **Best-effort, never throws** — the subdomain is a bonus channel, so a Vercel
 * hiccup must not break shop creation or a slug change. `addDomainToProject` is
 * idempotent (a domain already on the project just returns its status), so this
 * is safe to call repeatedly. Returns true on success.
 */
export async function registerShopSubdomain(slug: string): Promise<boolean> {
  const s = slug.trim().toLowerCase()
  if (!s) return false
  if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) return false
  try {
    await addDomainToProject(`${s}.${SHOP_SUBDOMAIN_ROOT}`)
    return true
  } catch (err) {
    console.error('[vercel-domains] registerShopSubdomain failed for', s, err)
    return false
  }
}

/** Root the shop subdomains live under. */
export const SHOP_SUBDOMAIN_ROOT = 'miyagisanchez.com'

// ── getDomainStatus ──────────────────────────────────────────────────────────

/**
 * Fetch current verification state from Vercel for a domain.
 * Poll this to show the tenant a live "verified / pending" badge.
 */
export async function getDomainStatus(domain: string): Promise<VercelDomainStatus> {
  const res = await fetch(
    `${API}/v10/projects/${projectId()}/domains/${encodeURIComponent(domain)}`,
    { headers: headers() }
  )
  const data = await res.json() as Record<string, unknown>

  if (!res.ok) {
    throw new Error(
      ((data.error as Record<string, unknown> | undefined)?.message as string | undefined)
      ?? `Vercel API error ${res.status}`
    )
  }

  return normalizeDomainResponse(data)
}

// ── getDomainConfig ──────────────────────────────────────────────────────────

/**
 * Fetch Vercel's live DNS-configuration view for a domain. This is the source of
 * truth for "is it pointing at us" — `misconfigured: false` means it resolves to
 * Vercel AND a TLS cert can be issued, which a raw `dns.resolve*` check can't tell
 * us (it's blind to per-project CNAME targets, the apex anycast IP changing, and
 * Cloudflare CNAME-flattening). Also surfaces the project-specific recommended
 * records so we write/show exactly what this project expects.
 */
export async function getDomainConfig(domain: string): Promise<VercelDomainConfig> {
  const res = await fetch(
    `${API}/v6/domains/${encodeURIComponent(domain)}/config`,
    { headers: headers() }
  )
  const data = await res.json() as Record<string, unknown>

  if (!res.ok) {
    throw new Error(
      ((data.error as Record<string, unknown> | undefined)?.message as string | undefined)
      ?? `Vercel API error ${res.status}`
    )
  }

  // recommendedIPv4: Array<{ rank, value: string[] }>; recommendedCNAME: Array<{ rank, value: string }>
  const ipv4 = (data.recommendedIPv4 as Array<{ rank?: number; value?: string[] }> | undefined) ?? []
  const cname = (data.recommendedCNAME as Array<{ rank?: number; value?: string }> | undefined) ?? []
  const topIpv4 = [...ipv4].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]?.value ?? []
  const topCname = [...cname].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]?.value ?? null

  return {
    misconfigured: !!data.misconfigured,
    configuredBy: (data.configuredBy as VercelDomainConfig['configuredBy']) ?? null,
    recommendedIPv4: topIpv4,
    recommendedCNAME: topCname,
  }
}

// ── removeDomainFromProject ──────────────────────────────────────────────────

/**
 * Remove a custom domain from the Vercel project.
 * Called when the tenant clears their custom domain in settings.
 */
export async function removeDomainFromProject(domain: string): Promise<void> {
  const res = await fetch(
    `${API}/v9/projects/${projectId()}/domains/${encodeURIComponent(domain)}`,
    { method: 'DELETE', headers: headers() }
  )
  if (!res.ok && res.status !== 404) {
    const data = await res.json() as Record<string, unknown>
    throw new Error(
      ((data.error as Record<string, unknown> | undefined)?.message as string | undefined)
      ?? `Vercel API error ${res.status}`
    )
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeDomainResponse(data: Record<string, unknown>): VercelDomainStatus {
  const verification = (data.verification as Array<Record<string, unknown>> | undefined) ?? []
  return {
    verified: !!(data.verified),
    cname_target: CNAME_TARGET,
    apex_name: (data.apexName as string | undefined) ?? null,
    verification: verification.map(v => ({
      type: String(v.type ?? ''),
      domain: String(v.domain ?? ''),
      value: String(v.value ?? ''),
      reason: String(v.reason ?? ''),
    })),
    error: null,
  }
}
