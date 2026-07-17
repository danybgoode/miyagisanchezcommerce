/**
 * GET    /api/sell/partner-grants — list active (unrevoked) partner_grants on
 *        the CALLER's OWN shop (partner code/name, role, since).
 * DELETE /api/sell/partner-grants — revoke a grant on the CALLER's OWN shop.
 *        body: { grant_id }.
 *
 * Miyagi Partners · Sprint 2 (US-2.3) — seller-side revoke. Mirrors
 * `/api/sell/agent-connector`'s shape: Clerk-authed, resolves the seller's own
 * shop by `clerk_user_id` (never trusts a caller-supplied shop id), and is
 * gated by the SAME `partners.mcp_enabled` kill-switch the rest of the epic
 * uses (flag off → 404, checked BEFORE auth/DB work — flag → auth ordering,
 * LEARNINGS) so this section stays invisible until the epic is live.
 *
 * Revocation sets `revoked_at` (never a delete — same discipline as the admin
 * console's revoke action) — the per-call resolver (`resolveToolShop`) treats
 * `revoked_at IS NOT NULL` as absent, so the partner's very next MCP call on
 * this shop denies (per-call check, no session grace, per the acceptance
 * criteria). Best-effort `tg.alert` on a successful revoke — ops visibility,
 * never load-bearing for the revoke itself.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { tg } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

interface OwnShop {
  id: string
  slug: string
  name: string
}

async function getOwnShop(userId: string): Promise<OwnShop | null> {
  const { data: shop, error } = await db
    .from('marketplace_shops')
    .select('id, slug, name')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !shop) return null
  return shop as OwnShop
}

export async function GET() {
  if (!(await isEnabled('partners.mcp_enabled'))) {
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { data: grantRows, error } = await db
    .from('partner_grants')
    .select('id, promoter_id, role, created_at')
    .eq('shop_id', shop.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'No se pudieron leer los accesos.' }, { status: 500 })

  const rows = (grantRows ?? []) as Array<{ id: string; promoter_id: string; role: string; created_at: string }>
  const promoterIds = [...new Set(rows.map((g) => g.promoter_id))]
  const { data: promoters, error: promotersError } = promoterIds.length
    ? await db.from('marketplace_promoters').select('id, code, name').in('id', promoterIds)
    : { data: [], error: null }
  if (promotersError) return NextResponse.json({ error: 'No se pudieron leer los socios.' }, { status: 500 })
  const promoterById = new Map((promoters ?? []).map((p) => [p.id as string, p as { id: string; code: string; name: string | null }]))

  return NextResponse.json({
    grants: rows.map((g) => ({
      id: g.id,
      role: g.role,
      since: g.created_at,
      partner: promoterById.get(g.promoter_id) ?? null,
    })),
  })
}

export async function DELETE(req: NextRequest) {
  if (!(await isEnabled('partners.mcp_enabled'))) {
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  let body: { grant_id?: string } = {}
  try { body = await req.json() } catch { /* validated below */ }
  const grantId = (body.grant_id ?? '').trim()
  if (!grantId) return NextResponse.json({ error: 'grant_id es obligatorio.' }, { status: 400 })

  // Ownership-checked: `.eq('shop_id', shop.id)` scopes the update to a grant on
  // THIS shop only — a grant_id belonging to another shop matches 0 rows (404),
  // never leaking whether it exists elsewhere.
  const { data: updated, error } = await db
    .from('partner_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', grantId)
    .eq('shop_id', shop.id)
    .is('revoked_at', null)
    .select('id, promoter_id')
  if (error) return NextResponse.json({ error: 'No se pudo revocar el acceso.' }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Acceso no encontrado (o ya revocado).' }, { status: 404 })
  }

  // Best-effort ops notification — never fails the revoke itself.
  tg.alert(`Acceso de socio revocado por el vendedor.\nTienda: ${shop.name} (${shop.slug})\nGrant: ${grantId}`).catch(() => {})

  return NextResponse.json({ ok: true })
}
