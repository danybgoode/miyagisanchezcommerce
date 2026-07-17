/**
 * Miyagi Partners — multi-shop MCP credential resolution (miyagi-partners-mcp S1).
 *
 * A partner (approved promoter, `marketplace_promoters` row) holds ONE
 * `ms_partner_…` credential reaching EVERY shop they're granted
 * (`partner_grants`, role manager|viewer). Two sub-shapes, mirroring the
 * seller credential pair in lib/agent-auth.ts:
 *   - token  (hash-stored at marketplace_promoters.partner_token_hash — shown once)
 *   - connector slug (PLAINTEXT at .partner_connector_slug — the /api/ucp/mcp/p/<slug>
 *     URL must be re-showable; rotation overwrites it, same as ms_connector_)
 * Both arrive here as `Bearer ms_partner_<suffix>`; resolution tries the hash
 * first, then the plaintext slug — two parameterized .eq lookups (never a
 * string-composed .or — the suffix is caller-controlled).
 *
 * `resolveToolShop` is the ONE seam every seller tool goes through:
 *   - seller credentials (ms_agent_/ms_connector_): byte-identical to
 *     resolveAgentShop — shop_slug ignored, generic unauthorized on failure.
 *   - partner credential: flag gate FIRST (`partners.mcp_enabled` off ⇒
 *     indistinguishable from a garbage token), then per-call grant check
 *     (revoke → very next call denies), shop_slug routing (defaults when
 *     exactly one grant), viewer-write denial naming the role, and a
 *     best-effort audit row in partner_tool_calls INCLUDING denials.
 */

import { timingSafeEqual } from 'crypto'
import { db } from './supabase'
import { isEnabled } from './flags'
import {
  parseBearer,
  classifyAgentCredential,
  hashAgentToken,
  resolveAgentShop,
  PARTNER_PREFIX,
  type AgentShop,
} from './agent-auth'

export type PartnerRole = 'manager' | 'viewer'

export interface PartnerContext {
  id: string
  code: string
  name: string | null
  role: PartnerRole
}

export type ToolShopResult =
  | { ok: true; shop: AgentShop; partner?: PartnerContext }
  | { ok: false; message: string | null } // null ⇒ caller uses its generic Unauthorized hint

// Viewer-callable read tools — pure list, kept next-free in its own module so
// the api spec can import it (see lib/partner-tools.ts).
import { PARTNER_READ_TOOLS } from './partner-tools'
export { PARTNER_READ_TOOLS }

interface PartnerRow {
  id: string
  code: string
  name: string | null
  partner_token_hash: string | null
  partner_connector_slug: string | null
}

const PARTNER_COLS = 'id, code, name, partner_token_hash, partner_connector_slug'
const SHOP_COLS = 'id, clerk_user_id, name, slug, description, location, logo_url, metadata'

function constantTimeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Resolve an ms_partner_ credential to its promoter row, or null. Pure lookup — no flag/grant logic. */
async function resolvePartnerRow(token: string): Promise<PartnerRow | null> {
  const suffix = token.slice(PARTNER_PREFIX.length)
  if (!suffix) return null

  // 1) token shape — SHA-256 of the full token (same discipline as ms_agent_).
  const hash = hashAgentToken(token)
  const { data: byHash } = await db
    .from('marketplace_promoters')
    .select(PARTNER_COLS)
    .eq('partner_token_hash', hash)
    .limit(1)
    .maybeSingle()
  if (byHash && typeof byHash.partner_token_hash === 'string' && constantTimeEq(byHash.partner_token_hash, hash)) {
    return byHash as PartnerRow
  }

  // 2) connector-slug shape — plaintext, re-showable (see header).
  const { data: bySlug } = await db
    .from('marketplace_promoters')
    .select(PARTNER_COLS)
    .eq('partner_connector_slug', suffix)
    .limit(1)
    .maybeSingle()
  if (bySlug && typeof bySlug.partner_connector_slug === 'string' && constantTimeEq(bySlug.partner_connector_slug, suffix)) {
    return bySlug as PartnerRow
  }

  return null
}

/** Best-effort per-call audit (incl. denials) — a logging failure never fails the call. */
async function auditPartnerCall(entry: {
  promoterId: string
  shopId?: string | null
  shopSlug?: string | null
  tool: string
  role?: PartnerRole | null
  outcome: 'ok' | 'denied_no_grant' | 'denied_role' | 'denied_ambiguous' | 'denied_revoked'
}): Promise<void> {
  try {
    // supabase-js reports failures via the returned error, not by throwing —
    // check it, or a failed security-audit write disappears silently.
    const { error } = await db.from('partner_tool_calls').insert({
      promoter_id: entry.promoterId,
      shop_id: entry.shopId ?? null,
      shop_slug: entry.shopSlug ?? null,
      tool: entry.tool,
      role: entry.role ?? null,
      outcome: entry.outcome,
    })
    if (error) console.error('[partner-auth] audit write failed:', error.message)
  } catch (e) {
    console.error('[partner-auth] audit write failed:', e)
  }
}

/**
 * The one seam every seller tool resolves its shop through.
 * `args` is the tool's raw argument object (only `shop_slug` is read here).
 */
export async function resolveToolShop(
  authHeader: string | null | undefined,
  args: Record<string, unknown> | undefined,
  tool: string,
): Promise<ToolShopResult> {
  const token = parseBearer(authHeader)
  if (!token) return { ok: false, message: null }

  if (classifyAgentCredential(token) !== 'partner') {
    // Seller credential — byte-identical to the pre-partner behavior:
    // shop_slug is ignored, failures are the generic unauthorized.
    const shop = await resolveAgentShop(authHeader)
    return shop ? { ok: true, shop } : { ok: false, message: null }
  }

  // Partner path. Flag gate FIRST — off ⇒ indistinguishable from a bad token
  // (per the dark-launch acceptance; also flag → auth ordering, LEARNINGS).
  if (!(await isEnabled('partners.mcp_enabled'))) return { ok: false, message: null }

  const partner = await resolvePartnerRow(token)
  if (!partner) return { ok: false, message: null }

  // Cap the audited slug (caller-controlled) so the audit table can't be
  // bloated; shop slugs are ≤40 chars by policy.
  const requestedSlug = typeof args?.shop_slug === 'string' ? args.shop_slug.trim().toLowerCase().slice(0, 64) : null

  // Grants are checked PER CALL — a revoke denies the very next call. Fetch
  // revoked rows too so the audit can tell "revoked" from "never granted".
  const { data: grants } = await db
    .from('partner_grants')
    .select('shop_id, role, revoked_at')
    .eq('promoter_id', partner.id)
  const allGrants = (grants ?? []) as Array<{ shop_id: string; role: PartnerRole; revoked_at: string | null }>
  const grantList = allGrants.filter((g) => g.revoked_at === null)
  const hadRevoked = allGrants.length > grantList.length

  if (grantList.length === 0) {
    await auditPartnerCall({ promoterId: partner.id, shopSlug: requestedSlug, tool, outcome: hadRevoked ? 'denied_revoked' : 'denied_no_grant' })
    return { ok: false, message: 'Tu credencial de socio no tiene tiendas asignadas (o el acceso fue revocado).' }
  }

  let shop: AgentShop | null = null
  let grant: { shop_id: string; role: PartnerRole } | undefined

  if (requestedSlug) {
    const { data } = await db
      .from('marketplace_shops')
      .select(SHOP_COLS)
      .eq('slug', requestedSlug)
      .limit(1)
      .maybeSingle()
    shop = (data as AgentShop | null) ?? null
    grant = shop ? grantList.find((g) => g.shop_id === shop!.id) : undefined
    if (!shop || !grant) {
      // Same MESSAGE whether the shop doesn't exist, isn't granted, or was
      // revoked — never confirm a shop's existence to an un-granted
      // credential. The audit row does distinguish a revoked pair.
      const wasRevoked = !!shop && allGrants.some((g) => g.shop_id === shop!.id && g.revoked_at !== null)
      await auditPartnerCall({ promoterId: partner.id, shopId: shop?.id ?? null, shopSlug: requestedSlug, tool, outcome: wasRevoked ? 'denied_revoked' : 'denied_no_grant' })
      return { ok: false, message: `No tienes acceso a la tienda \`${requestedSlug}\`. Usa shop_slug con una de tus tiendas asignadas.` }
    }
  } else if (grantList.length === 1) {
    grant = grantList[0]
    const { data } = await db
      .from('marketplace_shops')
      .select(SHOP_COLS)
      .eq('id', grant.shop_id)
      .limit(1)
      .maybeSingle()
    shop = (data as AgentShop | null) ?? null
    if (!shop) {
      await auditPartnerCall({ promoterId: partner.id, shopId: grant.shop_id, tool, role: grant.role, outcome: 'denied_no_grant' })
      return { ok: false, message: 'Tu tienda asignada ya no existe.' }
    }
  } else {
    await auditPartnerCall({ promoterId: partner.id, tool, outcome: 'denied_ambiguous' })
    return { ok: false, message: `Tienes ${grantList.length} tiendas asignadas — indica cuál con el argumento shop_slug.` }
  }

  if (grant.role === 'viewer' && !PARTNER_READ_TOOLS.has(tool)) {
    await auditPartnerCall({ promoterId: partner.id, shopId: shop.id, shopSlug: requestedSlug, tool, role: grant.role, outcome: 'denied_role' })
    return { ok: false, message: `Tu rol en esta tienda es \`viewer\` (solo lectura) — \`${tool}\` requiere el rol \`manager\`.` }
  }

  await auditPartnerCall({ promoterId: partner.id, shopId: shop.id, shopSlug: requestedSlug, tool, role: grant.role, outcome: 'ok' })
  return { ok: true, shop, partner: { id: partner.id, code: partner.code, name: partner.name, role: grant.role } }
}
