/**
 * Claim completion — the marketplace half of the shop-claim handshake
 * (Gem → Claimable Shop Loop · S2.2).
 *
 * The claim email (signed by /api/claim/send) lands the owner on the
 * despachobonsai dashboard, which authenticates them with Clerk and then calls
 * THIS endpoint server-to-server. Ownership truth lives on the Medusa seller
 * (`clerk_user_id` drives the "Sin reclamar" badge, /shop/manage and
 * /store/sellers/me), so this endpoint:
 *   1. re-verifies the claim JWT (shared CLAIM_JWT_SECRET),
 *   2. sets the Medusa seller's clerk_user_id via POST /internal/sellers/:id/claim,
 *   3. claims the Supabase mirror row (conversations / offers / agent tooling),
 *   4. approves the marketplace_claims record and busts the shop page cache.
 *
 *   POST /api/claim/complete   body: { token, clerk_user_id }
 *   Auth: x-claim-secret header must equal CLAIM_JWT_SECRET (server-to-server
 *   only — the caller, not this endpoint, authenticates the claiming user).
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/supabase'
import { verifyClaimToken } from '@/lib/claimJwt'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export async function POST(req: NextRequest) {
  const sharedSecret = process.env.CLAIM_JWT_SECRET
  if (!sharedSecret || !INTERNAL_SECRET) {
    console.error('[claim/complete] CLAIM_JWT_SECRET or MEDUSA_INTERNAL_SECRET missing')
    return NextResponse.json({ error: 'Configuración incompleta en el servidor.' }, { status: 500 })
  }
  if (req.headers.get('x-claim-secret') !== sharedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { token?: string; clerk_user_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const clerkUserId = body.clerk_user_id?.trim()
  if (!body.token || !clerkUserId) {
    return NextResponse.json({ error: 'token y clerk_user_id son requeridos' }, { status: 400 })
  }

  let payload
  try {
    payload = await verifyClaimToken(body.token)
  } catch {
    return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 400 })
  }

  // The claim page tokenizes the Medusa seller id (sel_…). Tolerate older
  // tokens that carried a Supabase mirror UUID by resolving it to the Medusa id.
  let sellerId = payload.shopId
  if (!sellerId.startsWith('sel_')) {
    const { data: mirror } = await db
      .from('marketplace_shops')
      .select('metadata')
      .eq('id', sellerId)
      .maybeSingle()
    const medusaId = (mirror?.metadata as Record<string, unknown> | null)?.medusa_seller_id
    if (typeof medusaId !== 'string' || !medusaId) {
      return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })
    }
    sellerId = medusaId
  }

  // ── 1. Transfer ownership on the Medusa seller (source of truth) ───────────
  const claimRes = await fetch(`${MEDUSA_BASE}/internal/sellers/${sellerId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify({ clerk_user_id: clerkUserId }),
  })
  const claimData = await claimRes.json().catch(() => ({})) as {
    seller?: { slug?: string }
    message?: string
  }

  if (claimRes.status === 404) {
    return NextResponse.json({ error: 'Tienda no encontrada' }, { status: 404 })
  }
  if (claimRes.status === 409) {
    return NextResponse.json({ error: claimData.message ?? 'La tienda ya fue reclamada.' }, { status: 409 })
  }
  if (!claimRes.ok) {
    console.error('[claim/complete] internal claim failed:', claimRes.status, claimData)
    return NextResponse.json({ error: 'No se pudo reclamar la tienda' }, { status: 502 })
  }

  // ── 2. Claim the Supabase mirror row (non-fatal) ───────────────────────────
  const { error: mirrorErr } = await db
    .from('marketplace_shops')
    .update({ clerk_user_id: clerkUserId, updated_at: new Date().toISOString() })
    .contains('metadata', { medusa_seller_id: sellerId })
    .is('clerk_user_id', null)
  if (mirrorErr) console.error('[claim/complete] mirror claim failed (non-fatal):', mirrorErr)

  // ── 3. Approve the pending claim record (non-fatal) ────────────────────────
  await db
    .from('marketplace_claims')
    .update({ status: 'approved' })
    .eq('shop_id', payload.shopId)

  // ── 4. Shop page stops showing "Sin reclamar" without waiting out ISR ──────
  revalidateTag('shops', 'default')
  revalidateTag('listings', 'default')

  return NextResponse.json({
    ok: true,
    shopName: payload.shopName,
    shopSlug: claimData.seller?.slug ?? payload.shopSlug,
  })
}
