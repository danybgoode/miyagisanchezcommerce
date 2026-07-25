/**
 * lib/portfolio/gate-server.ts
 *
 * Merchant Partner lifecycle · Sprint 1 — the ONE gate every new route in this
 * epic runs FIRST. Deliberately shaped EXACTLY like
 * `lib/relationship-access.ts#authorizeRelationshipRequest` (flag ⇒ 404, then
 * Clerk ⇒ 401, then rate limit ⇒ 429, then resolve the actor), differing in one
 * respect only: it reads the NEW `promoter.partner_portfolio_enabled` flag
 * instead of `promoter.activation_crm_enabled`.
 *
 * WHY A SECOND GATE RATHER THAN A PARAMETER ON THE FIRST: the shipped gate is
 * the entry point of every `/api/promoter/relationship*` and
 * `/api/admin/relationship*` route in production behind an already-ON flag.
 * Adding a flag parameter to it would edit the gate those live routes call —
 * a change with blast radius across three shipped epics, to save a dozen lines.
 * This module composes the SAME pieces (`isEnabled`, `currentUser`,
 * `checkRateLimit`, `resolveActor`) and returns the SAME result shape, so the
 * two can be compared side by side and can never diverge in posture without the
 * diff making it obvious. `resolveActor` in particular is IMPORTED, never
 * reimplemented — the four-actor precedence and the promoter/admin binding stay
 * defined in exactly one place (README D2).
 *
 * 404 (not 403/501) when the flag is OFF: indistinguishable from an absent
 * route, the same dark-launch posture `partners.mcp_enabled` and
 * `promoter.activation_crm_enabled` already take.
 *
 * Runtime: Node only (Clerk + Supabase service-role client).
 */
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { resolveActor, type RelationshipActor } from '@/lib/relationship-access'

/** The epic's enablement flag. Exported so the `/partner` page and
 *  `e2e/portfolio-routes.spec.ts` name the same string this gate reads, rather
 *  than each spelling it out. */
export const PORTFOLIO_FLAG = 'promoter.partner_portfolio_enabled' as const

export type PortfolioAuthResult =
  | { error: NextResponse; user?: undefined; actor?: undefined }
  | { error?: undefined; user: { id: string }; actor: RelationshipActor }

/**
 * Flag ⇒ 404 · no Clerk session ⇒ 401 · over the rate limit ⇒ 429 · otherwise
 * the caller's resolved actor. Reuses the `relationship` rate-limit bucket
 * on purpose: these routes read exactly the same records, at the same human
 * cadence, as the routes that bucket was sized for (60/10min per IP), and a
 * portfolio read must not be able to rate-limit a promoter out of a money route
 * — which is why that bucket is already separate from `checkout`.
 */
export async function authorizePortfolioRequest(req: NextRequest): Promise<PortfolioAuthResult> {
  if (!(await isEnabled(PORTFOLIO_FLAG))) {
    return { error: NextResponse.json({ ok: false }, { status: 404 }) }
  }

  const user = await currentUser().catch(() => null)
  if (!user) return { error: NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 }) }

  const rl = await checkRateLimit('relationship', getClientIp(req))
  if (!rl.allowed) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Demasiados intentos. Espera un momento.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      ),
    }
  }

  const actor = await resolveActor(user.id)
  return { user: { id: user.id }, actor }
}
