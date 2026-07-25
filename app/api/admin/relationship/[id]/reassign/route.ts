/**
 * POST /api/admin/relationship/[id]/reassign — the PRIVILEGED stewardship
 * reassignment (Merchant Partner lifecycle · Sprint 1, Story 1.3). ADMIN ONLY.
 *
 * A SECOND ROUTE, NOT A LOOSENED FIRST ONE. The shipped promoter-facing
 * `POST /api/promoter/relationship/[id]/owner` (activation-ops S2.2) is
 * deliberately left exactly as it is — neither widened nor narrowed to
 * admin-only, which would break its shipped behavior. Two routes, two audiences,
 * ONE writer (`lib/portfolio/reassign-server.ts#reassignSteward`), so the audit
 * ordering and the attribution guarantee cannot differ between them.
 *
 * WHAT THIS ROUTE ADDS over the promoter one:
 *   · `reason` REQUIRED — 422 without one. A privileged ownership change with no
 *     stated reason is the audit gap this story exists to close. AUDIT-ONLY: it
 *     is never rendered on the partner-facing portfolio.
 *   · `handoffNote` OPTIONAL — the ONLY partner-visible text. Daniel's call on
 *     fresh-reviewer finding 3 (PR 308): because `reason` is required, an admin
 *     writes it candidly ("moved off Juan, no follow-up in three weeks"), and
 *     showing that to every partner scoped to the merchant — possibly including
 *     Juan — is an information flow nobody had decided. Two fields: candid by
 *     default, shared on purpose. The private reason is never substituted in as a
 *     fallback when the note is absent.
 *   · `transferOpenTasks` REQUIRED — 422 without it. Silence is not an option: an
 *     open task left pointing at the old steward while the record moves is an
 *     orphan the queue would show to nobody. The response reports the count and
 *     the history row records it.
 *   · `effectiveAt` optional, defaulting to now; a `YYYY-MM-DD` value is
 *     interpreted through the SHIPPED `dueAtIsoFromDateOnly` (Mexico-City day
 *     end, calendar-validated).
 *   · `escalationClerkUserId` optional; `null` clears it.
 *
 * GATES, in order: `promoter.partner_portfolio_enabled` (404 when OFF,
 * indistinguishable from absent) → Clerk (401) → rate limit (429) →
 * `resolveRelationshipAccess` (403 for an id outside scope, carrying no record
 * fields) → `role === 'admin'` (403). The scope check is the ONE shared helper,
 * then narrowed explicitly: an owner/manager grant passes the shared check but
 * must NOT be able to perform a privileged reassignment — that is the same
 * two-step the shipped `correct-stage` route uses.
 *
 * ATTRIBUTION: this route builds no update payload of its own. Everything it
 * writes goes through `reassignSteward` → `buildStewardshipUpdate`, which can
 * only emit the four stewardship columns. `promoter_id`, `cohort`, `source`,
 * `preview_id` and `shop_id` are unreachable from here, and no commission or
 * transfer table is imported anywhere in `lib/portfolio/` — both proved in
 * `e2e/portfolio-reassign.spec.ts`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizePortfolioRequest } from '@/lib/portfolio/gate-server'
import { resolveRelationshipAccess, toRelationshipDTO } from '@/lib/relationship-access'
import { parseReassignBody } from '@/lib/portfolio/reassign'
import { reassignSteward } from '@/lib/portfolio/reassign-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (access.role !== 'admin') {
    return NextResponse.json(
      { ok: false, error: 'Solo un administrador puede reasignar el seguimiento de un comercio.' },
      { status: 403 },
    )
  }
  // Belt and braces: `resolveRelationshipAccess` returns `admin` only for a real
  // Clerk admin, but the flag-gate helper's own `actor.isAdmin` is asserted too,
  // so the admin narrowing does not rest on a single expression.
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  const now = new Date()
  const parsed = parseReassignBody(body, now)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status })
  }

  const result = await reassignSteward({
    relationshipId: id,
    fromSteward: access.relationship.steward_clerk_user_id,
    toSteward: parsed.value.toSteward,
    actorClerkUserId: auth.user.id,
    reason: parsed.value.reason,
    handoffNote: parsed.value.handoffNote,
    effectiveAt: parsed.value.effectiveAt,
    escalationClerkUserId: parsed.value.escalationClerkUserId,
    transferOpenTasks: parsed.value.transferOpenTasks,
    now,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, ...(result.tasksTransferred !== undefined ? { tasksTransferred: result.tasksTransferred } : {}) },
      { status: result.status },
    )
  }

  return NextResponse.json({
    ok: true,
    relationship: toRelationshipDTO(result.relationship),
    ownerHistoryRecorded: true,
    // Reported explicitly, both numbers: "how many were open" and "how many
    // moved". `transferOpenTasks: false` therefore reads as a deliberate
    // "N tasks stayed with the previous steward", never as silence.
    openTaskCount: result.openTaskCount,
    tasksTransferred: result.tasksTransferred,
  })
}
