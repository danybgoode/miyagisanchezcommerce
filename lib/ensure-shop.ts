import 'server-only'
import { currentUser } from '@clerk/nextjs/server'
import { ensureSupabaseShopMirror, type MedusaSellerForMirror } from '@/lib/provisioning'
import { tg } from '@/lib/telegram'

/**
 * lib/ensure-shop.ts
 *
 * Idempotent create-or-get for the signed-in user's Medusa seller —
 * extracted from `POST /api/sell/shop`'s handler (onboarding
 * three-doors epic, Sprint 1 · Story 1.2b) so a second caller
 * (`app/(shell)/shop/manage/import/page.tsx`'s no-seller gate) can reuse the
 * exact same creation logic instead of forking a second path. Returns the
 * existing seller unchanged (200) or creates one with a Clerk-profile-
 * derived fallback name (201) — same behavior `/api/sell/shop`'s POST
 * handler always had, byte-for-byte, just callable from server code that
 * isn't a route handler.
 */

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

export interface ShopCreateInput {
  name?: string
  slug?: string
  state?: string
  city?: string
  description?: string
}

export type EnsureShopResult =
  | { ok: true; status: 200 | 201; shopSlug: string }
  | { ok: false; status: number; error: string; field?: string }

export async function ensureShop(userId: string, clerkJwt: string, body: ShopCreateInput = {}): Promise<EnsureShopResult> {
  // Idempotent: if a Medusa seller already exists, return it unchanged.
  const existingRes = await medusaFetch('/store/sellers/me', clerkJwt)
  if (existingRes.ok) {
    const { seller } = await existingRes.json() as { seller: MedusaSellerForMirror }
    await ensureSupabaseShopMirror(seller, userId).catch(() => {})
    return { ok: true, status: 200, shopSlug: seller.slug }
  }
  if (existingRes.status !== 404) {
    const errBody = await existingRes.json().catch(() => ({})) as { message?: string }
    console.error('[ensure-shop] sellers/me failed:', existingRes.status, errBody)
    return { ok: false, status: 500, error: errBody.message ?? 'Error al verificar tu tienda.' }
  }

  // No seller yet — create one.
  let shopName = body.name?.trim() ?? ''
  if (!shopName) {
    const clerkUser = await currentUser()
    shopName = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ')
      || clerkUser?.emailAddresses[0]?.emailAddress?.split('@')[0]
      || 'Mi tienda'
  }
  if (shopName.length < 2) {
    return { ok: false, status: 422, error: 'El nombre de la tienda debe tener al menos 2 caracteres.', field: 'name' }
  }
  if (shopName.length > 80) {
    return { ok: false, status: 422, error: 'El nombre no puede superar los 80 caracteres.', field: 'name' }
  }

  const location = [body.city?.trim(), body.state?.trim()].filter(Boolean).join(', ') || null

  const createRes = await medusaFetch('/store/sellers/me', clerkJwt, {
    method: 'POST',
    body: JSON.stringify({
      name: shopName,
      ...(body.slug?.trim() && { slug: body.slug.trim() }),
      description: body.description?.trim() || null,
      location,
    }),
  })
  const createData = await createRes.json()
  if (!createRes.ok || !createData.seller) {
    console.error('[ensure-shop] seller creation failed:', createRes.status, createData)
    return { ok: false, status: 500, error: 'No se pudo crear la tienda. Inténtalo de nuevo.' }
  }

  const seller = createData.seller as MedusaSellerForMirror
  await ensureSupabaseShopMirror(seller, userId).catch((e) => {
    console.error('[ensure-shop] Supabase mirror sync failed (non-fatal):', e)
  })

  // Net-new shop only — ping the ops chat (fire-and-forget). The idempotent
  // already-exists branch above returns before reaching here, so a re-call
  // never double-pings.
  tg.newShop(shopName, location, seller.slug)

  return { ok: true, status: 201, shopSlug: seller.slug }
}
