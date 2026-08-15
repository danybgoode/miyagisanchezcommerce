import 'server-only'
/**
 * Who a broadcast would actually reach.
 *
 * The I/O half of `lib/notifications/broadcast.ts` — it resolves addresses and makes
 * no decisions. Its one contract: **an audience it cannot read is an ERROR, never an
 * empty list.** A broadcast surface that renders "0 recipients" from a failed query
 * invites an operator to conclude nobody needs telling, which is the exact shape of
 * the failures this week's audit spent a day unpicking.
 */
import { db } from '@/lib/supabase'
import { getSellerEmail } from '@/lib/email'
import type { BroadcastAudience } from '@/lib/notifications/broadcast'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export type Recipient = { email: string; clerkUserId: string | null; label: string }

export type RecipientResolution =
  | { ok: true; recipients: Recipient[]; skipped: { label: string; reason: string }[] }
  | { ok: false; message: string }

/** How many Clerk email lookups run at once. Matches `/admin/tenants`' own bound. */
const CLERK_CONCURRENCY = 6

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        out[index] = await fn(items[index])
      }
    }),
  )
  return out
}

/**
 * Sellers = every shop with a linked Clerk account, addressed by the email Clerk
 * holds for them. Unclaimed (supply-imported) shops have no owner and are reported
 * as SKIPPED with the reason, not silently dropped — "we could not reach 8 of your
 * shops" is a fact an operator should see before sending.
 */
async function resolveSellers(): Promise<RecipientResolution> {
  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, name, clerk_user_id')
    .not('clerk_user_id', 'is', null)
    .order('name')

  if (error) return { ok: false, message: `No se pudo leer la lista de tiendas: ${error.message}` }

  const shops = (data ?? []) as Array<{ id: string; name: string; clerk_user_id: string }>

  // One row per PERSON, not per shop: an owner with three shops gets one email.
  const byUser = new Map<string, string[]>()
  for (const shop of shops) {
    byUser.set(shop.clerk_user_id, [...(byUser.get(shop.clerk_user_id) ?? []), shop.name])
  }

  type Resolved =
    | { recipient: Recipient; skip?: undefined }
    | { skip: { label: string; reason: string }; recipient?: undefined }

  const entries = [...byUser.entries()]
  const resolved = await mapWithConcurrency<[string, string[]], Resolved>(
    entries,
    CLERK_CONCURRENCY,
    async ([clerkUserId, names]) => {
      const label = names.join(', ')
      try {
        const email = await getSellerEmail(clerkUserId)
        return email
          ? { recipient: { email, clerkUserId, label } }
          : { skip: { label, reason: 'sin correo en Clerk' } }
      } catch {
        return { skip: { label, reason: 'no se pudo leer el correo' } }
      }
    },
  )

  return {
    ok: true,
    recipients: resolved.flatMap((r) => (r.recipient ? [r.recipient] : [])),
    skipped: resolved.flatMap((r) => (r.skip ? [r.skip] : [])),
  }
}

/**
 * Buyers = everyone who has actually placed an order. Medusa owns orders, so the
 * list comes from the backend rather than the (empty, legacy) Supabase mirror.
 */
async function resolveBuyers(): Promise<RecipientResolution> {
  if (!INTERNAL_SECRET) {
    return { ok: false, message: 'MEDUSA_INTERNAL_SECRET no está configurado — no se puede leer la lista de compradores.' }
  }
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/buyers`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, message: `Medusa respondió ${res.status} al leer los compradores.` }
    const data = (await res.json()) as { emails?: unknown }
    if (!Array.isArray(data.emails)) return { ok: false, message: 'Respuesta inesperada de Medusa.' }
    return {
      ok: true,
      recipients: data.emails
        .filter((e): e is string => typeof e === 'string' && e.includes('@'))
        .map((email) => ({ email, clerkUserId: null, label: email })),
      skipped: [],
    }
  } catch (e) {
    return { ok: false, message: `No se pudo contactar a Medusa: ${e instanceof Error ? e.message : 'error'}` }
  }
}

export function resolveBroadcastRecipients(audience: BroadcastAudience): Promise<RecipientResolution> {
  return audience === 'sellers' ? resolveSellers() : resolveBuyers()
}
