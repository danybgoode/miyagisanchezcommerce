/**
 * Admin partner-credential management (miyagi-partners-mcp S1) — the "manual
 * admin path" the Sprint-1 smoke walkthrough starts from. Clerk admin-gated
 * via withAdmin (every mutation lands in admin_audit_log automatically).
 *
 *   GET  /api/admin/partners
 *        → promoters with partner-credential status + their grants
 *   POST /api/admin/partners   body: one of
 *        { action: 'mint',   promoter_id }            → mint/rotate token + connector URL (plaintext shown ONCE)
 *        { action: 'grant',  promoter_id, shop_slug, role? }  → add an active grant (default manager)
 *        { action: 'revoke', grant_id }               → set revoked_at (per-call check denies immediately)
 *
 * Dark by design: credentials minted here are inert until `partners.mcp_enabled`
 * flips — resolveToolShop rejects partner tokens with the flag off.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { generatePartnerToken, generateConnectorSlug } from '@/lib/agent-auth'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const { data: promoters, error } = await db
    .from('marketplace_promoters')
    .select('id, code, name, created_at, partner_token_hash, partner_connector_slug')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: 'No se pudieron leer los socios.' }, { status: 500 })

  const { data: grants, error: grantsError } = await db
    .from('partner_grants')
    .select('id, promoter_id, shop_id, role, granted_by, created_at, revoked_at')
    .order('created_at', { ascending: false })
  if (grantsError) return NextResponse.json({ error: 'No se pudieron leer los accesos.' }, { status: 500 })

  const shopIds = [...new Set((grants ?? []).map((g) => g.shop_id))]
  const { data: shops, error: shopsError } = shopIds.length
    ? await db.from('marketplace_shops').select('id, slug, name').in('id', shopIds)
    : { data: [], error: null }
  if (shopsError) return NextResponse.json({ error: 'No se pudieron leer las tiendas.' }, { status: 500 })
  const shopById = new Map((shops ?? []).map((s) => [s.id, s]))

  return NextResponse.json({
    partners: (promoters ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      has_credential: !!p.partner_token_hash,
      // The connector slug is stored PLAINTEXT precisely so the URL is
      // re-showable (the token is not — hash only). Admin-gated surface.
      connector_url: p.partner_connector_slug
        ? `https://miyagisanchez.com/api/ucp/mcp/p/${p.partner_connector_slug}`
        : null,
      grants: (grants ?? [])
        .filter((g) => g.promoter_id === p.id)
        .map((g) => ({
          id: g.id,
          shop: shopById.get(g.shop_id) ?? { id: g.shop_id },
          role: g.role,
          granted_by: g.granted_by,
          created_at: g.created_at,
          revoked_at: g.revoked_at,
        })),
    })),
  })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: { action?: string; promoter_id?: string; shop_slug?: string; role?: string; grant_id?: string }
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    body = parsed
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (body.action === 'mint') {
    if (!body.promoter_id) return NextResponse.json({ error: 'promoter_id es obligatorio.' }, { status: 400 })
    const { token, hash } = generatePartnerToken()
    const connectorSlug = generateConnectorSlug()
    const { data: updated, error } = await db
      .from('marketplace_promoters')
      .update({ partner_token_hash: hash, partner_connector_slug: connectorSlug })
      .eq('id', body.promoter_id)
      .select('id, code')
    if (error) return NextResponse.json({ error: 'No se pudo generar la credencial.' }, { status: 500 })
    if (!updated || updated.length === 0) return NextResponse.json({ error: 'Socio no encontrado.' }, { status: 404 })
    // Plaintext shown ONCE (token) — only its hash persists. The connector
    // slug is stored plaintext so the URL stays re-showable (rotation = re-mint).
    return NextResponse.json({
      token,
      connector_url: `https://miyagisanchez.com/api/ucp/mcp/p/${connectorSlug}`,
      note: 'Guarda el token ahora — no se puede volver a mostrar. Re-generar invalida el token y la URL anteriores.',
    })
  }

  if (body.action === 'grant') {
    if (!body.promoter_id || !body.shop_slug) {
      return NextResponse.json({ error: 'promoter_id y shop_slug son obligatorios.' }, { status: 400 })
    }
    // Reject unknown roles rather than silently upgrading a typo to manager
    // (mutation on an auth surface: reject, don't coerce — LEARNINGS).
    const role = body.role ?? 'manager'
    if (role !== 'viewer' && role !== 'manager') {
      return NextResponse.json({ error: 'role debe ser manager o viewer.' }, { status: 400 })
    }
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('id, slug, name')
      .eq('slug', body.shop_slug.trim().toLowerCase())
      .limit(1)
      .maybeSingle()
    if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
    const { data: grant, error } = await db
      .from('partner_grants')
      .insert({ promoter_id: body.promoter_id, shop_id: shop.id, role, granted_by: 'admin' })
      .select('id')
      .single()
    if (error || !grant) {
      // Unique partial index: one ACTIVE grant per partner↔shop pair.
      return NextResponse.json({ error: 'No se pudo crear el acceso (¿ya existe uno activo para esa tienda?).' }, { status: 409 })
    }
    return NextResponse.json({ grant_id: grant.id, shop: { slug: shop.slug, name: shop.name }, role }, { status: 201 })
  }

  if (body.action === 'revoke') {
    if (!body.grant_id) return NextResponse.json({ error: 'grant_id es obligatorio.' }, { status: 400 })
    const { data: updated, error } = await db
      .from('partner_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.grant_id)
      .is('revoked_at', null)
      .select('id')
    if (error) return NextResponse.json({ error: 'No se pudo revocar.' }, { status: 500 })
    if (!updated || updated.length === 0) return NextResponse.json({ error: 'Acceso no encontrado (o ya revocado).' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'action debe ser mint | grant | revoke.' }, { status: 400 })
})
