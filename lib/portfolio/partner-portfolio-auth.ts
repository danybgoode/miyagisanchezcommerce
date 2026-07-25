/**
 * lib/portfolio/partner-portfolio-auth.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.2 — resolves an
 * `ms_partner_` MCP credential into the SAME `RelationshipActor` shape the
 * UI builds (README D2). Reuses, never forks:
 *
 *   - `partners.mcp_enabled` FIRST — OFF is indistinguishable from a bad
 *     token, the exact dark-launch posture `lib/partner-auth.ts#resolveToolShop`
 *     already takes.
 *   - `resolvePartnerRow` (`lib/partner-auth.ts`, exported for this reuse) —
 *     the SAME credential resolution (hash lookup, then plaintext
 *     connector-slug lookup, both constant-time compared). No parallel copy
 *     of security-sensitive matching logic.
 *   - `partner_tool_calls` — the SAME audit table `resolveToolShop` already
 *     writes to, so a partner's tool-call history stays in ONE table
 *     regardless of which surface (seller tools vs. portfolio tools) they
 *     used. Written on every outcome once a promoter row is resolved
 *     (`ok` / `denied_no_grant` / `denied_revoked`) — mirroring
 *     `resolveToolShop`'s own scope: a bad/absent token or a disabled flag
 *     never resolves a promoter id, so there is nothing to audit yet,
 *     exactly as `resolveToolShop` behaves today.
 *
 * DOES NOT USE `resolveToolShop` (D2): that function routes a partner
 * credential to exactly ONE shop and DENIES when the partner holds >1 grant
 * and passes no `shop_slug` — structurally wrong for "list my whole
 * portfolio", which by definition spans every shop the partner is granted.
 * This function instead maps the resolved promoter straight onto the SAME
 * `RelationshipActor` shape `lib/relationship-access.ts#resolveActor` builds
 * for a Clerk session, so `listScopedRelationships` (via `loadPortfolio`)
 * returns the partner's WHOLE multi-shop population — never a per-shop
 * routing decision at all.
 *
 * `isAdmin: false` IS STRUCTURALLY IMPOSSIBLE TO SET HERE — the returned
 * `RelationshipActor` object literal hard-codes the field to the literal
 * `false`; there is no branch, no variable, no partner-row column that
 * could ever flip it. An MCP credential is never a Clerk admin session
 * (build contract). `e2e/portfolio-partner-mcp.spec.ts` asserts this by
 * SOURCE TEXT (the literal `isAdmin: false` with no variable on the
 * right-hand side), not merely by behavior, so a future edit that swaps in
 * a variable fails the spec even before it could ever be exercised at
 * runtime.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { parseBearer, classifyAgentCredential } from '@/lib/agent-auth'
import { resolvePartnerRow } from '@/lib/partner-auth'
import type { RelationshipActor } from '@/lib/relationship-access'

export type PortfolioActorResult =
  | { ok: true; actor: RelationshipActor; partnerId: string; partnerCode: string }
  | { ok: false; message: string | null }

type PortfolioAuditOutcome = 'ok' | 'denied_no_grant' | 'denied_revoked'

/** Best-effort audit into the SAME `partner_tool_calls` table
 *  `lib/partner-auth.ts#resolveToolShop` already writes to — a logging
 *  failure never fails the call. */
async function auditPortfolioCall(promoterId: string, tool: string, outcome: PortfolioAuditOutcome): Promise<void> {
  try {
    const { error } = await db.from('partner_tool_calls').insert({ promoter_id: promoterId, tool, outcome })
    if (error) console.error('[portfolio/partner-auth] audit write failed:', error.message)
  } catch (e) {
    console.error('[portfolio/partner-auth] audit write failed:', e)
  }
}

/**
 * Resolve an `Authorization: Bearer ms_partner_…` header into the SAME
 * `RelationshipActor` shape `/partner`'s UI route builds for a Clerk
 * session. `tool` is a short label for the audit row (the calling MCP
 * route's own name is enough — the per-relationship 403 that matters is
 * `resolveRelationshipAccess`'s job, not this function's).
 */
export async function resolvePartnerPortfolioActor(
  authHeader: string | null | undefined,
  tool: string,
): Promise<PortfolioActorResult> {
  const token = parseBearer(authHeader)
  if (!token || classifyAgentCredential(token) !== 'partner') return { ok: false, message: null }

  // Flag gate FIRST — off ⇒ indistinguishable from a bad token (same
  // posture as `resolveToolShop`; also flag → auth ordering, LEARNINGS).
  if (!(await isEnabled('partners.mcp_enabled'))) return { ok: false, message: null }

  const partner = await resolvePartnerRow(token)
  if (!partner) return { ok: false, message: null }

  // Grants are checked PER CALL — a revoke denies the very next call, same
  // discipline as `resolveToolShop`. Fetch revoked rows too so the audit
  // can tell "revoked" from "never granted".
  const { data: grants } = await db.from('partner_grants').select('shop_id, revoked_at').eq('promoter_id', partner.id)
  const allGrants = (grants ?? []) as Array<{ shop_id: string; revoked_at: string | null }>
  const activeGrants = allGrants.filter((g) => g.revoked_at === null)
  const hadRevoked = allGrants.length > activeGrants.length

  if (activeGrants.length === 0) {
    await auditPortfolioCall(partner.id, tool, hadRevoked ? 'denied_revoked' : 'denied_no_grant')
    return {
      ok: false,
      message: 'Tu credencial de socio no tiene tiendas asignadas (o el acceso fue revocado).',
    }
  }

  await auditPortfolioCall(partner.id, tool, 'ok')

  return {
    ok: true,
    partnerId: partner.id,
    partnerCode: partner.code,
    actor: {
      // A synthetic, never-a-real-Clerk-id identity — `listScopedRelationships`'s
      // C1 steward mirror keys off `clerkUserId`, so this shape can never
      // accidentally collide with (and grant unintended steward access
      // through) a real `user_…` Clerk id.
      clerkUserId: `partner:${partner.id}`,
      promoterId: partner.id,
      promoterCode: partner.code,
      isAdmin: false,
    },
  }
}
