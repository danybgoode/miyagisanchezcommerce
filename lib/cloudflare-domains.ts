/**
 * lib/cloudflare-domains.ts
 *
 * Programmatic Cloudflare for SaaS (Custom Hostnames) domain management for
 * the "own channel" feature — the Sprint 4 provider swap for lib/vercel-domains.ts.
 * Adds / verifies / removes tenant custom domains as Cloudflare Custom Hostnames
 * against our fallback origin (the ALB) so they resolve with automatic SSL.
 *
 * Exports the SAME names/shapes as lib/vercel-domains.ts on purpose — this is a
 * seam swap, not a new API. `DomainStatus`/`DomainConfig` are deliberately
 * provider-neutral types (not "Cloudflare-shaped"), so callers never see which
 * provider is behind the seam.
 *
 * Cloudflare hostname IDs are NEVER persisted — every lookup is by hostname
 * name (GET .../custom_hostnames?hostname=), matching the sprint's acceptance
 * criteria. This costs one extra API call on delete (look up the id, then use
 * it transiently) but keeps the DB provider-agnostic.
 *
 * Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID from env.
 * Server-only — never import in client components.
 */

import { CNAME_TARGET } from './domain-utils'

const CF_API = 'https://api.cloudflare.com/client/v4'

/**
 * Thrown when the hostname is already registered as a custom hostname
 * elsewhere (a different Cloudflare account/zone) — i.e. it's genuinely taken.
 * The route maps this to a friendly 409, same contract as the Vercel seam.
 */
export class DomainConflictError extends Error {
  constructor(public detail: string) {
    super('domain_conflict')
    this.name = 'DomainConflictError'
  }
}

function headers() {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function zoneId() {
  const id = process.env.CLOUDFLARE_ZONE_ID
  if (!id) throw new Error('CLOUDFLARE_ZONE_ID is not set')
  return id
}

// ── Types (provider-neutral — mirror VercelDomainStatus/VercelDomainConfig) ──

export type DomainStatus = {
  /** Whether Cloudflare has verified ownership + issued SSL for this hostname */
  verified: boolean
  /** The CNAME value the tenant must point their domain to */
  cname_target: string
  /** The registrable apex, derived locally (Cloudflare's object has no apexName field) */
  apex_name: string | null
  /** Pending verification challenges (TXT ownership + SSL validation records) */
  verification: Array<{ type: string; domain: string; value: string; reason: string }>
  error: string | null
}

/**
 * Cloudflare's live view of a custom hostname's readiness. Mirrors
 * VercelDomainConfig's contract (`misconfigured: false` = genuinely live) even
 * though Cloudflare's own field names differ completely underneath.
 *
 * Note (flagged, not guessed): Cloudflare does not publish a fixed
 * tenant-facing apex A-record IP the way Vercel's per-project anycast IP
 * worked — `recommendedIPv4` is always empty here. Apex domains are told to
 * CNAME-flatten to `cname_target` (most modern registrars support ALIAS/ANAME
 * at the root); this should be confirmed against a live add during Story 4.2's
 * smoke test, not assumed.
 */
export type DomainConfig = {
  /** false = ownership verified AND SSL issued (i.e. genuinely ready to serve). */
  misconfigured: boolean
  /** Cloudflare doesn't classify this the way Vercel did — 'CNAME' once active, else null. */
  configuredBy: 'A' | 'CNAME' | 'http' | 'dns-01' | null
  /** Always empty — see note above. */
  recommendedIPv4: string[]
  /** The fallback-origin CNAME target. */
  recommendedCNAME: string | null
}

/** Exported for test fixtures (e2e/cloudflare-domains.spec.ts). */
export type CfCustomHostname = {
  id: string
  hostname: string
  status?: string
  ssl?: {
    status?: string
    validation_records?: Array<{ txt_name?: string; txt_value?: string; http_url?: string; http_body?: string }>
    validation_errors?: Array<{ message?: string }>
  }
  ownership_verification?: { type?: string; name?: string; value?: string }
}

async function cfApi(path: string, opts: RequestInit = {}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${CF_API}${path}`, { ...opts, headers: { ...headers(), ...(opts.headers as Record<string, string> | undefined) } })
  // Read as text first — a transient edge outage (502/504) returns an HTML page,
  // not JSON, and parsing that directly throws a SyntaxError that masks the real
  // HTTP status and bypasses the caller's conflict/error mapping entirely.
  const body = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error(`Cloudflare ${path} → ${res.status} (non-JSON response): ${body.slice(0, 300)}`)
  }
  return { ok: res.ok && json.success !== false, status: res.status, json }
}

/**
 * Exported (not just internal) so the response-mapping seam is directly
 * unit-testable — e2e/cloudflare-domains.spec.ts — without a live API call.
 */
export function cfErrorMessage(json: Record<string, unknown>, fallback: string): string {
  const errors = json.errors as Array<{ message?: string; code?: number }> | undefined
  return errors?.[0]?.message ?? fallback
}

/** True when Cloudflare's error payload signals "hostname already claimed elsewhere". */
export function isConflict(status: number, json: Record<string, unknown>): boolean {
  if (status === 409) return true
  const errors = json.errors as Array<{ code?: number }> | undefined
  // 1406/1409: Cloudflare's documented "hostname already exists" custom-hostname codes.
  return !!errors?.some(e => e.code === 1406 || e.code === 1409)
}

// ── addDomainToProject ───────────────────────────────────────────────────────

/**
 * Register a tenant domain as a Cloudflare Custom Hostname against our
 * fallback origin. TXT ownership validation — does NOT require the seller's
 * DNS to point at us yet (unlike Vercel, where adding the domain to the
 * project was itself the only step). Must be called server-side when the
 * tenant saves their domain in settings.
 */
export async function addDomainToProject(domain: string): Promise<DomainStatus> {
  const { ok, status, json } = await cfApi(`/zones/${zoneId()}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname: domain,
      ssl: { method: 'txt', type: 'dv' },
      custom_origin_server: CNAME_TARGET,
    }),
  })

  if (!ok) {
    if (isConflict(status, json)) {
      // Same ambiguity as the Vercel seam: "already exists" can mean (a) it's
      // already registered as OUR custom hostname (harmless — read its status)
      // or (b) it's genuinely claimed elsewhere. Try a lookup before conceding.
      try {
        return await getDomainStatus(domain)
      } catch {
        throw new DomainConflictError(cfErrorMessage(json, 'domain_conflict'))
      }
    }
    throw new Error(cfErrorMessage(json, `Cloudflare API error ${status}`))
  }

  return normalizeHostname(json.result as CfCustomHostname)
}

// ── getDomainStatus ──────────────────────────────────────────────────────────

/**
 * Fetch current verification state from Cloudflare for a domain, by hostname
 * name (never by a persisted id). Poll this to show the tenant a live
 * "verified / pending" badge.
 */
export async function getDomainStatus(domain: string): Promise<DomainStatus> {
  const hostname = await findHostname(domain)
  if (!hostname) throw new Error(`Cloudflare custom hostname not found: ${domain}`)
  return normalizeHostname(hostname)
}

// ── getDomainConfig ──────────────────────────────────────────────────────────

/**
 * Fetch Cloudflare's live readiness view for a domain — the source of truth
 * for "is it pointing at us and can we serve it", same contract as Vercel's
 * getDomainConfig(). See the DomainConfig type doc for the apex-IP caveat.
 */
export async function getDomainConfig(domain: string): Promise<DomainConfig> {
  const hostname = await findHostname(domain)
  if (!hostname) {
    return { misconfigured: true, configuredBy: null, recommendedIPv4: [], recommendedCNAME: CNAME_TARGET }
  }
  const active = hostname.status === 'active' || hostname.status === 'active_redeploying'
  return {
    misconfigured: !active,
    configuredBy: active ? 'CNAME' : null,
    recommendedIPv4: [],
    recommendedCNAME: CNAME_TARGET,
  }
}

// ── removeDomainFromProject ──────────────────────────────────────────────────

/**
 * Remove a tenant domain's Cloudflare custom hostname. Called when the tenant
 * clears their custom domain in settings. Looks the id up by hostname first
 * (never persisted) — a 404 on lookup is treated as already-removed, same as
 * the Vercel seam's 404-is-fine handling.
 */
export async function removeDomainFromProject(domain: string): Promise<void> {
  const hostname = await findHostname(domain)
  if (!hostname) return // already gone — nothing to do

  const { ok, status, json } = await cfApi(`/zones/${zoneId()}/custom_hostnames/${hostname.id}`, {
    method: 'DELETE',
  })
  if (!ok && status !== 404) {
    throw new Error(cfErrorMessage(json, `Cloudflare API error ${status}`))
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function findHostname(domain: string): Promise<CfCustomHostname | null> {
  const { ok, status, json } = await cfApi(`/zones/${zoneId()}/custom_hostnames?hostname=${encodeURIComponent(domain)}`)
  if (!ok) throw new Error(cfErrorMessage(json, `Cloudflare API error ${status}`))
  const results = (json.result as CfCustomHostname[] | undefined) ?? []
  return results.find(r => r.hostname === domain) ?? null
}

/** Exported for the response-mapping unit spec (e2e/cloudflare-domains.spec.ts). */
export function normalizeHostname(hostname: CfCustomHostname): DomainStatus {
  const active = hostname.status === 'active' || hostname.status === 'active_redeploying'
  const verification: DomainStatus['verification'] = []

  const ownership = hostname.ownership_verification
  if (ownership?.name && ownership?.value) {
    verification.push({
      type: ownership.type ?? 'txt',
      domain: ownership.name,
      value: ownership.value,
      reason: 'ownership_verification',
    })
  }
  for (const rec of hostname.ssl?.validation_records ?? []) {
    if (rec.txt_name && rec.txt_value) {
      verification.push({ type: 'txt', domain: rec.txt_name, value: rec.txt_value, reason: 'ssl_validation' })
    }
  }

  const sslError = hostname.ssl?.validation_errors?.[0]?.message ?? null

  return {
    verified: active,
    cname_target: CNAME_TARGET,
    apex_name: null, // derive via domain-utils.apexOf(hostname.hostname) at the call site if needed
    verification,
    error: active ? null : sslError,
  }
}
