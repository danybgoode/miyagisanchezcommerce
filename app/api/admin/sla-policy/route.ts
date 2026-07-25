/**
 * GET / PUT /api/admin/sla-policy — the admin read/write surface for the single
 * versioned response-window policy (Merchant Partner lifecycle · Sprint 1,
 * Story 1.1; README D3). ADMIN ONLY, gated FIRST by
 * `promoter.partner_portfolio_enabled` (404 when OFF, indistinguishable from an
 * absent route) via `authorizePortfolioRequest`.
 *
 * NO ADMIN UI IN v1 — stated deliberately (build contract). This route exists so
 * the seed's "SLA rules configured by admin" is genuinely true without building
 * a CRUD product for it: the policy is editable by an admin with an HTTP client,
 * every write bumps `version`, and the CODE default
 * (`lib/portfolio/sla.ts#DEFAULT_SLA_POLICY`) remains the authoritative fallback
 * whenever the stored row is absent or unreadable. A future admin screen is a
 * consumer of this route, not a rewrite of it.
 *
 * ADMIN GATE — DEVIATION FROM THE BUILD CONTRACT'S WORDING, stated rather than
 * silently resolved. sprint-1.md says this route is "`requireAdmin`-gated".
 * `lib/admin/guard.ts#requireAdmin` is a PAGE guard: its failure mode is
 * `redirect('/')`, which in a route handler produces a redirect rather than a
 * status, and it cannot run after a flag check that must 404 first. This route
 * therefore uses the shape every sibling admin JSON route in this family
 * already uses (`/api/admin/scorecard`, `/api/admin/relationships`): the shared
 * flag-first gate, then an explicit `actor.isAdmin` check ⇒ 403. Same authority
 * (`lib/admin/identity.ts` via `resolveActor`), route-appropriate failure mode.
 *
 * VALIDATION IS THE PURE PARSER, NOT THIS ROUTE. The body is validated by
 * `parseSlaPolicy` (`lib/portfolio/sla.ts`) — the SAME function that validates a
 * document read back out of the database. A document this route accepts is
 * therefore, by construction, a document the reader will accept; there is no
 * second, more permissive validation path. A malformed body is rejected 422
 * rather than silently stored and silently fallen-back-over on the next read.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizePortfolioRequest } from '@/lib/portfolio/gate-server'
import { loadSlaPolicy, writeSlaPolicy } from '@/lib/portfolio/policy-server'
import { DEFAULT_SLA_POLICY, parseSlaPolicy, serializeSlaPolicy, SLA_POLICY_VERSION } from '@/lib/portfolio/sla'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  const loaded = await loadSlaPolicy()
  return NextResponse.json({
    ok: true,
    // `source` is reported, never hidden: an admin must be able to tell "nobody
    // has configured a policy" from "the configured policy could not be read",
    // even though both resolve to the same windows.
    source: loaded.source,
    codeDefaultVersion: SLA_POLICY_VERSION,
    policy: serializeSlaPolicy(loaded.policy),
    updatedBy: loaded.updatedBy,
    updatedAt: loaded.updatedAt,
  })
}

export async function PUT(req: NextRequest) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  const candidate = (body as { policy?: unknown } | null)?.policy
  if (candidate === undefined) {
    return NextResponse.json({ ok: false, error: 'Falta el campo "policy".' }, { status: 422 })
  }

  // `parseSlaPolicy` FAILS CLOSED to the code default, which is exactly right on
  // the READ path and exactly wrong on the WRITE path: silently storing the
  // default in place of a document the admin actually sent would report success
  // for a change that never happened. Reference equality tells the two apart —
  // the parser returns the default OBJECT ITSELF on rejection, and a genuinely
  // valid document always parses into a fresh object.
  const parsed = parseSlaPolicy(candidate)
  if (parsed === DEFAULT_SLA_POLICY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Política inválida. Cada una de las 13 etapas requiere { responseDays, stallDays } con enteros positivos y stallDays ≥ responseDays.',
      },
      { status: 422 },
    )
  }

  // The client never chooses the version — `writeSlaPolicy` derives it from the
  // stored row so it can only ever move forward.
  const written = await writeSlaPolicy(parsed, auth.user.id)
  if (!written.ok) {
    return NextResponse.json({ ok: false, error: written.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, policy: serializeSlaPolicy(written.policy) })
}
