type Env = Record<string, string | undefined>

/**
 * Keep the server endpoint dynamic. NEXT_PUBLIC_MEDUSA_STORE_URL is deliberately
 * baked into the browser bundle, whereas this is an internal, secret-bearing hop.
 */
export function getMedusaInternalBaseUrl(env: Env = process.env): string {
  return (env['MEDUSA_STORE_URL'] || 'http://localhost:9000').replace(/\/+$/, '')
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; cause?: { code?: unknown } }
  if (typeof candidate.code === 'string') return candidate.code
  if (typeof candidate.cause?.code === 'string') return candidate.cause.code
  return null
}

/** Safe to persist in an admin-only batch error: no credentials or request body. */
export function describeMedusaNetworkFailure(operation: string, baseUrl: string, error: unknown): string {
  const host = new URL(baseUrl).host
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  return `${operation} network failure to ${host}: ${message}${code ? ` (${code})` : ''}`
}

export type MedusaInternalProbe = {
  reachable: boolean
  authorized: boolean
  status: number | null
  endpoint: string
  error: string | null
}

/**
 * A missing reserved slug should be 404. That still proves DNS/TLS/routing and
 * the internal-secret guard are working, without creating or mutating a seller.
 */
export async function probeMedusaInternal(
  secret: string,
  deps: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<MedusaInternalProbe> {
  const baseUrl = deps.baseUrl ?? getMedusaInternalBaseUrl()
  const fetchImpl = deps.fetchImpl ?? fetch
  const endpoint = new URL(baseUrl).host
  try {
    const response = await fetchImpl(`${baseUrl}/internal/sellers/slug?slug=__miyagi_supply_probe__`, {
      headers: { 'x-internal-secret': secret },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    return {
      reachable: true,
      authorized: response.status !== 401 && response.status !== 403,
      status: response.status,
      endpoint,
      error: null,
    }
  } catch (error) {
    return {
      reachable: false,
      authorized: false,
      status: null,
      endpoint,
      error: describeMedusaNetworkFailure('Medusa readiness probe', baseUrl, error),
    }
  }
}
