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

const API = 'https://api.vercel.com'

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
    // Domain already registered on this project — not a real error
    if ((data.error as Record<string, unknown> | undefined)?.code === 'domain_already_in_use') {
      return getDomainStatus(domain)
    }
    throw new Error(
      ((data.error as Record<string, unknown> | undefined)?.message as string | undefined)
      ?? `Vercel API error ${res.status}`
    )
  }

  return normalizeDomainResponse(data)
}

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
    cname_target: 'cname.vercel-dns.com',
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
