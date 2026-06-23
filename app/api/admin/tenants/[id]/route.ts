/**
 * Admin tenant entitlement — per-shop detail + grant/revoke (admin-consolidation
 * · S4.1). Clerk-gated via `withAdmin`; the POST is audited for free (S2.1 writes
 * an `admin_audit_log` row on every successful mutation via `after()`).
 *
 *   GET  /api/admin/tenants/:id  — resolve the ONE shop's true entitlement reason
 *                                  (incl. the per-seller `subscription` lookup the
 *                                  directory list deliberately skips), closing the
 *                                  S3 `subscriptionUnchecked` gap for the inspected shop.
 *   POST /api/admin/tenants/:id  — { action:'grant'|'revoke', note? }: write/clear
 *                                  the custom-domain comp on the shop's metadata.
 *
 * `:id` is the `marketplace_shops` mirror row id (the `shopId` each TenantRow
 * carries). S4.0 confirmed the live paywall reads the grant from
 * `marketplace_shops.metadata.custom_domain_grant` (the same place this writes),
 * so the grant takes effect across the connect UI, the domain mutation routes,
 * and the MCP `get_domain_entitlement` tool with no further change.
 *
 * The grant shape is composed by `buildCompGrant` (`lib/domain-entitlement`) so it
 * is byte-identical to what `readDomainGrant`/`deriveDomainEntitlement` honor — we
 * wrap the existing seam, never invent a parallel grant format.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { buildCompGrant, readDomainGrant } from '@/lib/domain-entitlement'
import { resolveDomainEntitlement } from '@/lib/domain-entitlement-server'

export const dynamic = 'force-dynamic'

type ShopRow = { metadata: Record<string, unknown> | null; clerk_user_id: string | null }

/** Load the mirror row this action targets; null when it doesn't exist. */
async function loadShop(id: string): Promise<ShopRow | null> {
  const { data, error } = await db
    .from('marketplace_shops')
    .select('metadata, clerk_user_id')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[admin/tenants/:id] shop read error:', error.message)
    return null
  }
  return (data as ShopRow | null) ?? null
}

/**
 * Resolve the true entitlement for one shop (incl. the per-seller subscription).
 * Also returns the raw durable `grant` so the UI can show an active comp even when
 * the paywall flag is off and the derived reason (`flag_off`) hides it.
 */
async function resolvedEntitlement(shop: ShopRow) {
  const ent = await resolveDomainEntitlement(shop.metadata, {
    sellerClerkId: shop.clerk_user_id ?? undefined,
  })
  return {
    entitlementReason: ent.reason,
    entitled: ent.entitled,
    grant: readDomainGrant(shop.metadata),
  }
}

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withAdmin<NextRequest, RouteCtx>(async (_req, { params }) => {
  const { id } = await params
  const shop = await loadShop(id)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  return NextResponse.json(await resolvedEntitlement(shop))
})

export const POST = withAdmin<NextRequest, RouteCtx>(async (req, { params }) => {
  const { id } = await params

  let body: { action?: unknown; note?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  const action = body.action
  if (action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ error: 'Acción inválida (usa "grant" o "revoke").' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note : undefined

  const shop = await loadShop(id)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  // Build the next metadata: grant writes the canonical comp shape, revoke clears
  // the durable grant key (returning the shop to its underlying reason). This
  // action only manages the **comp**: revoking a `grandfather` grant (stamped at
  // cutover) would silently strip a different, permanent entitlement, so refuse it
  // here — it is not what the inspector's "Revocar cortesía" promises.
  // NOTE: this read-modify-writes the whole `metadata` blob (the established
  // pattern, cf. scripts/backfill-domain-grandfather.mjs); the load→write window
  // is small and this is a rare manual admin action, so a concurrent seller
  // metadata edit racing it is an accepted v1 risk rather than a JSONB-merge RPC.
  const existing = readDomainGrant(shop.metadata)
  if (action === 'revoke' && existing?.type === 'grandfather') {
    return NextResponse.json(
      { error: 'No se puede revocar una concesión heredada (cutover) desde aquí.' },
      { status: 409 },
    )
  }

  const metadata: Record<string, unknown> = { ...(shop.metadata ?? {}) }
  if (action === 'grant') {
    metadata.custom_domain_grant = buildCompGrant({ note })
  } else {
    delete metadata.custom_domain_grant
  }

  // `.select()` so we can confirm a row actually matched — a 0-row update must not
  // be reported as success (and audited) as if it had landed.
  const { data: updated, error } = await db
    .from('marketplace_shops')
    .update({ metadata })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) {
    // 502 (≥400) keeps `withAdmin` from auditing a failed write — best-effort
    // discipline: never report a mutation that didn't land.
    console.error('[admin/tenants/:id] entitlement write error:', error.message)
    return NextResponse.json({ error: 'No se pudo guardar la cortesía de dominio.' }, { status: 502 })
  }
  if (!updated) {
    // The row vanished between load and write — not an error, but not a mutation.
    return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  }

  // Reflect the real post-action state (re-resolve on the written metadata).
  return NextResponse.json(await resolvedEntitlement({ ...shop, metadata }))
})
