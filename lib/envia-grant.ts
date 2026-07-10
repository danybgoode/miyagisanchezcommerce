/**
 * lib/envia-grant.ts
 *
 * Reads/writes the Envía comp-grant (shipping-provider-expansion · Sprint 2)
 * on a Medusa seller's own metadata via the backend's internal grant route
 * (`/internal/sellers/:id/grant`) — the grant lives on the Medusa seller, NOT
 * the Supabase `marketplace_shops` mirror (AGENTS Rule #1: fulfillment lives
 * in Medusa). Same x-internal-secret pattern already used by
 * app/api/webhooks/envia/route.ts.
 *
 * `getEnviaGrant`/`setEnviaGrant` return the full grant (shape reused from
 * `lib/domain-entitlement.ts`'s `DomainGrant` — `{type:'comp', granted_at,
 * note?}` — byte-identical to what the backend writes) for the admin surface.
 * `hasEnviaGrant` is the boolean-only convenience used by callers that don't
 * already have the Medusa seller's own metadata in hand (the legacy
 * Supabase-order ship/re-quote routes, which only ever load the Supabase shop
 * row). All fail closed (null/false) on any error — consistent with the
 * platform's fail-safe default for Envía enablement.
 */

import type { DomainGrant } from '@/lib/domain-entitlement'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export async function getEnviaGrant(medusaSellerId: string | null | undefined): Promise<DomainGrant | null> {
  if (!medusaSellerId || !MEDUSA_INTERNAL_SECRET) return null
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/sellers/${medusaSellerId}/grant`, {
      headers: { 'x-internal-secret': MEDUSA_INTERNAL_SECRET },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { grant?: DomainGrant | null }
    return data.grant ?? null
  } catch (err) {
    console.warn('[envia-grant] read failed:', err)
    return null
  }
}

export async function hasEnviaGrant(medusaSellerId: string | null | undefined): Promise<boolean> {
  return Boolean(await getEnviaGrant(medusaSellerId))
}

export async function setEnviaGrant(
  medusaSellerId: string,
  action: 'grant' | 'revoke',
  note?: string,
): Promise<DomainGrant | null> {
  const res = await fetch(`${MEDUSA_BASE}/internal/sellers/${medusaSellerId}/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': MEDUSA_INTERNAL_SECRET,
    },
    body: JSON.stringify({ action, ...(note ? { note } : {}) }),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Envía grant write failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { grant?: DomainGrant | null }
  return data.grant ?? null
}
