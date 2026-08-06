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
import { PORTFOLIO_FLAG } from '@/lib/portfolio/gate-server'
import { getPartnerIdentityById } from '@/lib/promoter'
import { parseBearer, classifyAgentCredential } from '@/lib/agent-auth'
import { resolvePartnerRow } from '@/lib/partner-auth'
import type { RelationshipActor } from '@/lib/relationship-access'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'

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

  // BOTH flag gates FIRST — off ⇒ indistinguishable from a bad token (same
  // posture as `resolveToolShop`; also flag → auth ordering, LEARNINGS).
  //
  // `promoter.partner_portfolio_enabled` was MISSING here (fresh-reviewer finding
  // 1, PR 311) and its absence was the epic's worst defect: `partners.mcp_enabled`
  // has been ON in production since 2026-07-17 (verified live again 2026-07-25),
  // so this route — which carries the agent WRITE path, `propose_task_update` →
  // `confirm_task_update` — would have gone live the moment the branch deployed,
  // with the epic's own kill-switch still OFF and before ANY of the smokes the
  // README says Daniel flips it after.
  //
  // Every other surface in the epic gates on `PORTFOLIO_FLAG` through
  // `lib/portfolio/gate-server.ts`. This module cannot reuse that helper (it takes
  // a `NextRequest` and resolves a Clerk session, neither of which exists on a
  // Bearer-credential MCP call), so it imports the FLAG KEY by reference — never a
  // second string literal, which is how the two would have drifted apart again.
  //
  // Checked in this order deliberately: the epic flag first, so a caller cannot
  // distinguish "this epic is dark" from "MCP is dark" from "bad token" — all
  // three are the same silent `null` message.
  if (!(await isEnabled(PORTFOLIO_FLAG))) return { ok: false, message: null }
  if (!(await isEnabled('partners.mcp_enabled'))) return { ok: false, message: null }

  const partner = await resolvePartnerRow(token)
  if (!partner) return { ok: false, message: null }
  if (partner.program_track === 'founding_operator' && !(await recruitingV3Enabled())) {
    return { ok: false, message: null }
  }

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

  // THE REAL CLERK ID, so the tool and the UI resolve the SAME population
  // (fresh-reviewer finding 5, PR 311). The first cut used a synthetic
  // `partner:<id>`, reasoning that it could never collide with a real Clerk id —
  // safe, but it silently broke the parity this story's acceptance is ABOUT:
  // `listScopedRelationships`'s C1 steward mirror keys off `actor.clerkUserId`, so
  // a promoter who is the assigned STEWARD of a relationship (but neither its
  // `promoter_id` owner nor a grant-holder) saw it in `/partner` and did NOT see it
  // via `list_portfolio`. The row sets differed — fail-closed, so never a leak, but
  // "UI and tool results agree" was simply not true, and the build contract's
  // required row-set parity spec had not been written either.
  //
  // Read through the track-aware `getPartnerIdentityById` helper (`lib/promoter.ts`) rather
  // than a raw query here — two reasons, and the second one is the interesting one:
  //   1. `PARTNER_COLS` in `lib/partner-auth.ts` feeds every seller tool's
  //      credential resolution; this epic does not need to widen a shared seam to
  //      answer one question about one promoter.
  //   2. `e2e/portfolio-reassign.spec.ts`'s population guard forbids ANY module
  //      under `lib/portfolio/` from referencing `marketplace_promoters` — that is
  //      the promoter/commission/attribution table, and the guard is what proves
  //      this epic can never reach compensation truth. My first cut queried it
  //      directly for one column and tripped that guard, correctly. Reusing the
  //      existing helper keeps the reference (and the temptation) out of
  //      `lib/portfolio/` entirely, so the guard needs no exception — a genuinely
  //      better outcome than the narrow exemption I first reached for.
  //
  // FAIL-CLOSED on absence: an unbound promoter (no `clerk_user_id`) keeps the
  // synthetic identity, which resolves to strictly FEWER rows (no steward mirror)
  // rather than more. A null must never widen access, and `.eq(null)` would.
  const bound = await getPartnerIdentityById(partner.id)
  const boundClerkId =
    typeof bound?.clerk_user_id === 'string' && bound.clerk_user_id ? bound.clerk_user_id : null

  return {
    ok: true,
    partnerId: partner.id,
    partnerCode: partner.code,
    actor: {
      clerkUserId: boundClerkId ?? `partner:${partner.id}`,
      promoterId: partner.id,
      promoterCode: partner.code,
      programTrack: partner.program_track,
      // `isAdmin` is an inline literal with no variable, no branch and no spread —
      // an MCP credential is never a Clerk admin session, and that must be
      // structurally impossible to set rather than merely defaulted (D2).
      isAdmin: false,
    },
  }
}
