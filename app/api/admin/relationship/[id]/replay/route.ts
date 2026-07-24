/**
 * POST /api/admin/relationship/[id]/replay — re-run the commerce-fact adapter
 * + stage resolver for ONE relationship (founding-merchant-activation-ops
 * S3.3). ADMIN ONLY. This is `lib/merchant-relationship-lifecycle.ts#evaluateRelationship`
 * called directly — there is no separate "replay" code path, because the
 * evaluator is ALREADY idempotent by construction (build contract: the
 * transition insert dedupes on `(relationship_id, dedupe_key)`, and
 * `advanceDedupeKey(stage)` is the SAME stable key on every call for the same
 * stage). Re-running it on unchanged facts writes nothing; re-running it on a
 * newly-true fact (a delayed Medusa read, a correction that unblocked a gated
 * stage) lets the walk reach further — that IS the repair the acceptance
 * criterion asks for, with no duplicate transition or duplicate Golden Beans
 * event possible.
 *
 * Scope-checked through the same `resolveRelationshipAccess` every
 * relationship route uses, then narrowed to `role === 'admin'` — mirrors
 * `POST /api/admin/relationship/[id]/correct-stage` exactly (an owner/manager
 * grant can SEE a relationship's reconciliation state but not force a replay).
 *
 * NO MEDUSA WRITE CLIENT HERE OR IN ANYTHING THIS CALLS (build contract:
 * "reconciliation cannot edit Medusa ownership, products, orders or
 * payments") — `evaluateRelationship` only reads Medusa via
 * `lib/merchant-commerce-facts.ts`'s GET-only adapter.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest, resolveRelationshipAccess } from '@/lib/relationship-access'
import { evaluateRelationship } from '@/lib/merchant-relationship-lifecycle'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (access.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Solo un administrador puede repetir la evaluación.' }, { status: 403 })
  }

  const outcome = await evaluateRelationship(id)
  if (!outcome) {
    return NextResponse.json({ ok: false, error: 'No se pudo leer la relación.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, outcome })
}
