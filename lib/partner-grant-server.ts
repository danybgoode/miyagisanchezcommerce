/**
 * lib/partner-grant-server.ts
 *
 * Miyagi Partners · Sprint 2 (US-2.1) — promoter-close auto-grant.
 *
 * When a bound promoter who ALSO holds a partner MCP credential
 * (`marketplace_promoters.partner_token_hash IS NOT NULL`) stands up a shop for
 * a merchant, this mints the `partner_grants` row (role `manager`, `granted_by:
 * 'promoter-close'`) so the shop shows up in the partner's `/partner` dashboard
 * and MCP scope with zero admin touch. A closer WITHOUT a partner credential —
 * the common case — closes exactly as today: no error, no grant, no write at all.
 *
 * Wiring note (see PR body for the fuller rationale): `POST /api/promoter/shop/
 * setup` is the ONE seam where a "close" actually CREATES the shop (mints the
 * Medusa seller + Supabase mirror). Every other `/api/promoter/close/<sku>`
 * route (domain, subdomain, ml-sync, migration, print, listing) operates on a
 * shop that already exists — resolved via `resolveTargetShop({ shopId, slug })`
 * — and the `/promotor/cerrar` client (`PromoterCloseClient.tsx`) never renders
 * those steps until `shop/setup` has already returned a shop. So `shop/setup`
 * is the single convergence point every close variant passes through, and the
 * only place this needs to be called from.
 *
 * Mirrors `lib/promoter-grant-server.ts`'s exact safety discipline:
 *   - read-modify-write (read the promoter's credential state, then insert),
 *   - verify the write affected a row (an insert `.select()` returning 0 rows,
 *     or an error, is a failure — never a silent false "succeeded"),
 *   - best-effort: a failure here NEVER fails the close (log + `tg.alert`; the
 *     caller always gets a resolved result, never a thrown error).
 *
 * Idempotent: `partner_grants_active_uniq` (promoter_id, shop_id WHERE
 * revoked_at IS NULL) 409s a duplicate insert (Postgres `23505`) — treated as a
 * no-op, not a failure, so a retried/duplicate close never errors.
 *
 * server-only (Supabase + Telegram + the platform flag reader).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'
import { isEnabled } from '@/lib/flags'

export interface AutoGrantResult {
  /** Always true — this is best-effort and never surfaces a failure to the close path. */
  ok: true
  /** True only when a NEW grant row was actually inserted this call. */
  granted: boolean
}

/**
 * Auto-grant the closing promoter `manager` access to the shop they just stood
 * up, IF they hold a partner credential and `partners.mcp_enabled` is on.
 * Never throws; never fails the caller — see file header.
 */
export async function autoGrantPartnerOnClose(input: {
  promoterId: string
  shopId: string
}): Promise<AutoGrantResult> {
  const { promoterId, shopId } = input
  try {
    // Flag gate FIRST — off means this whole feature is inert (dark-launch),
    // matching the resolver's own flag → auth/DB ordering (lib/partner-auth.ts).
    if (!(await isEnabled('partners.mcp_enabled'))) return { ok: true, granted: false }

    const { data: promoter, error: readError } = await db
      .from('marketplace_promoters')
      .select('partner_token_hash')
      .eq('id', promoterId)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    // No partner credential — this promoter closes exactly as today. No error, no grant.
    if (!promoter?.partner_token_hash) return { ok: true, granted: false }

    const { data: inserted, error: insertError } = await db
      .from('partner_grants')
      .insert({ promoter_id: promoterId, shop_id: shopId, role: 'manager', granted_by: 'promoter-close' })
      .select('id')
    if (insertError) {
      // 23505 = unique_violation on partner_grants_active_uniq — an ACTIVE grant
      // for this promoter↔shop pair already exists (idempotent retry / double
      // close). No-op, not a failure.
      if (insertError.code === '23505') return { ok: true, granted: false }
      throw new Error(insertError.message)
    }
    if (!inserted || inserted.length === 0) {
      throw new Error(`grant insert matched 0 rows (shop ${shopId}, promoter ${promoterId})`)
    }

    return { ok: true, granted: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[partner-grant] auto-grant on close failed:', message)
    tg.alert(
      `Auto-grant de socio falló tras cerrar una tienda — repara a mano si el promotor ` +
      `tiene credencial de socio (\`partner_token_hash\`).\nShop: ${shopId}\nPromotor: ${promoterId}\nError: ${message}`,
    )
    return { ok: true, granted: false }
  }
}
