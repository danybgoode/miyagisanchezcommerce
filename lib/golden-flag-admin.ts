import 'server-only'
import { parseGoldenFlagEnvironment, type GoldenFlagEnvironment } from './flag-provider-mode'

export type GoldenAdminFlag = {
  key: string
  value: boolean
  definitionVersion: number
  criticality: 'low' | 'medium' | 'high'
  polarity: 'killswitch' | 'enablement'
  description: string
  reason: 'STATIC'
}

export type GoldenAdminSnapshot = {
  environment: GoldenFlagEnvironment
  snapshotVersion: number
  snapshotUpdatedAt: string | null
  flags: GoldenAdminFlag[]
}

export class GoldenFlagAdminUnavailable extends Error {}

function config(): { baseUrl: string; credential: string; environment: GoldenFlagEnvironment } {
  const baseUrl = process.env.GROWTH_ENGINE_URL?.replace(/\/+$/, '')
  const credential = process.env.GOLDEN_BEANS_FLAG_ADMIN_KEY
  const environment = parseGoldenFlagEnvironment(process.env.GOLDEN_BEANS_FLAG_ENVIRONMENT)
  if (!baseUrl || !credential || !environment) throw new GoldenFlagAdminUnavailable('Flag admin is not configured')
  return { baseUrl, credential, environment }
}

function isGoldenFlag(value: unknown): value is GoldenAdminFlag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const flag = value as Record<string, unknown>
  return (
    typeof flag.key === 'string' &&
    typeof flag.value === 'boolean' &&
    Number.isSafeInteger(flag.definitionVersion) &&
    (flag.criticality === 'low' || flag.criticality === 'medium' || flag.criticality === 'high') &&
    (flag.polarity === 'killswitch' || flag.polarity === 'enablement') &&
    typeof flag.description === 'string' &&
    flag.reason === 'STATIC'
  )
}

function parseSnapshot(value: unknown, environment: GoldenFlagEnvironment): GoldenAdminSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  if (
    snapshot.environment !== environment ||
    !Number.isSafeInteger(snapshot.snapshotVersion) ||
    Number(snapshot.snapshotVersion) < 0 ||
    (snapshot.snapshotUpdatedAt !== null && typeof snapshot.snapshotUpdatedAt !== 'string') ||
    !Array.isArray(snapshot.flags) ||
    !snapshot.flags.every(isGoldenFlag)
  ) {
    return null
  }
  return {
    environment,
    snapshotVersion: Number(snapshot.snapshotVersion),
    snapshotUpdatedAt: snapshot.snapshotUpdatedAt as string | null,
    flags: snapshot.flags,
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, credential } = config()
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${credential}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(2_000),
    })
  } catch {
    throw new GoldenFlagAdminUnavailable('Golden flag administration is unavailable')
  }
}

/** The browser never receives this credential; only a Clerk-admin-gated Miyagi server call reaches Golden. */
export async function getGoldenAdminSnapshot(): Promise<GoldenAdminSnapshot> {
  const { environment } = config()
  const response = await request('/api/v1/flags/admin')
  if (!response.ok) throw new GoldenFlagAdminUnavailable('Golden flag administration is unavailable')
  const snapshot = parseSnapshot(await response.json().catch(() => null), environment)
  if (!snapshot) throw new GoldenFlagAdminUnavailable('Golden returned an invalid flag administration snapshot')
  return snapshot
}

export async function setGoldenAdminFlag(input: {
  key: string
  enabled: boolean
  expectedSnapshotVersion: number
  reason: string
  clerkActorId: string
}): Promise<
  | { ok: true; snapshotVersion: number; definitionVersion: number; changed: boolean }
  | { ok: false; status: 409 | 503; error: string }
> {
  const response = await request('/api/v1/flags/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // This header is assembled only after Miyagi's server-side Clerk admin check. Golden records
      // it separately from its credential owner; accepting it from the browser would forge audit data.
      'X-Miyagi-Clerk-Actor': input.clerkActorId,
    },
    body: JSON.stringify({
      key: input.key,
      enabled: input.enabled,
      expectedSnapshotVersion: input.expectedSnapshotVersion,
      reason: input.reason,
    }),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.status === 409) return { ok: false, status: 409, error: 'La versión cambió. Actualiza y vuelve a intentar.' }
  if (!response.ok) return { ok: false, status: 503, error: 'No se pudo actualizar la flag en Golden.' }
  if (
    !body ||
    body.ok !== true ||
    !Number.isSafeInteger(body.snapshotVersion) ||
    !Number.isSafeInteger(body.definitionVersion) ||
    typeof body.changed !== 'boolean'
  ) {
    return { ok: false, status: 503, error: 'Golden devolvió una respuesta inválida.' }
  }
  return {
    ok: true,
    snapshotVersion: Number(body.snapshotVersion),
    definitionVersion: Number(body.definitionVersion),
    changed: body.changed,
  }
}
