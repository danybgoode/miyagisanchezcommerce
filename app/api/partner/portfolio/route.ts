/**
 * GET /api/partner/portfolio — the Merchant Partner stewardship work queue
 * (Merchant Partner lifecycle · Sprint 1, Story 1.2). The caller's OWNED +
 * STEWARDED + GRANTED merchants, enriched with stage age, next action, blocker,
 * consent state and the SLA response state, filtered and ordered by urgency.
 *
 * SCOPE IS NOT RE-IMPLEMENTED (README D2). The population is
 * `listScopedRelationships` via `lib/portfolio/loader.ts` — the LIST sibling of
 * `resolveRelationshipAccess`'s per-id rule, same four actors. There is no
 * authorization decision in this file: an ungranted id is not IN the list, and
 * the per-id 403 for a direct read of one belongs to the existing
 * `/api/promoter/relationship/[id]` routes, which already enforce it.
 *
 * Gated FIRST by `promoter.partner_portfolio_enabled` (404 when OFF,
 * indistinguishable from an absent route), then Clerk (401), then the rate
 * limit (429) — `authorizePortfolioRequest`.
 *
 * A READ FAILURE IS A 500, NEVER A SILENTLY-EMPTY 200. Every read behind
 * `loadPortfolio` fails closed, and this route surfaces that as an error — the
 * exact rule `listScopedRelationships` and `enrichRelationships` already apply,
 * and the exact bug (`[]` standing in for a failed read) that shipped twice in
 * this family.
 *
 * SAFE-ONLY CONTACT DATA. The row DTO exposes the preferred-channel LABEL and
 * never a phone/email/WhatsApp/Instagram VALUE — see
 * `lib/portfolio/resolver.ts`'s header. This is the widest surface in the epic.
 *
 * Only GET is exported; there is no write method on this route at all.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizePortfolioRequest } from '@/lib/portfolio/gate-server'
import { loadPortfolio } from '@/lib/portfolio/loader'
import { parsePortfolioFilters } from '@/lib/portfolio/resolver'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error

  const filters = parsePortfolioFilters(new URL(req.url).searchParams)
  const result = await loadPortfolio(auth.actor, filters)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, portfolio: result.portfolio })
}
