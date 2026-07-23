/**
 * POST /api/promoter/relationship/[id]/interaction — append one interaction
 * (note/call/whatsapp/visit/email/other) to a relationship's history
 * (founding-merchant-activation-ops S2.2). APPEND-ONLY: there is no UPDATE
 * path on `merchant_relationship_interactions` at all, at the schema or the
 * route level — an edit is a NEW row, mirroring S1's field-audit trail and
 * the consent-previews decision log.
 *
 * Scope-checked through the ONE shared helper (`resolveRelationshipAccess`);
 * a `viewer` partner-grant may READ the relationship but not WRITE an
 * interaction (`canWriteRelationship`). Gated by
 * `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 *
 * C9 fix (PR 304 review): `body`/`occurredAt` are now runtime type-checked
 * BEFORE `.trim()`/`new Date(...)` touch them — a non-string `body`
 * (`{body: {}}`) used to reach `.trim()` and 500.
 *
 * Caller-controlled `occurredAt` upper bound (PR 304 review, "answer, don't
 * fix" list): capped at `now + 1 day` — cheap, and `created_at` already
 * preserves the real write time regardless of what `occurredAt` claims.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { authorizeRelationshipRequest, resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

const INTERACTION_KINDS = ['note', 'call', 'whatsapp', 'visit', 'email', 'other'] as const
type InteractionKind = (typeof INTERACTION_KINDS)[number]

function isInteractionKind(value: unknown): value is InteractionKind {
  return typeof value === 'string' && (INTERACTION_KINDS as readonly string[]).includes(value)
}

interface InteractionBody {
  kind?: string
  body?: string
  occurredAt?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Tu acceso a este registro es de solo lectura (viewer) — agregar una interacción requiere el rol manager.',
      },
      { status: 403 },
    )
  }

  let body: InteractionBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  if (!isInteractionKind(body.kind)) {
    return NextResponse.json({ ok: false, error: 'Tipo de interacción inválido.' }, { status: 400 })
  }

  let occurredAt = new Date()
  if (body.occurredAt !== undefined) {
    if (typeof body.occurredAt !== 'string') {
      return NextResponse.json({ ok: false, error: 'Fecha inválida.' }, { status: 400 })
    }
    occurredAt = new Date(body.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json({ ok: false, error: 'Fecha inválida.' }, { status: 400 })
    }
    if (occurredAt.getTime() > Date.now() + 86_400_000) {
      return NextResponse.json({ ok: false, error: 'La fecha no puede ser más de un día en el futuro.' }, { status: 400 })
    }
  }

  if (body.body !== undefined && typeof body.body !== 'string') {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la interacción inválido.' }, { status: 400 })
  }
  const text = (body.body ?? '').trim()

  const { data, error } = await db
    .from('merchant_relationship_interactions')
    .insert({
      relationship_id: id,
      kind: body.kind,
      body: text || null,
      author_clerk_user_id: auth.user.id,
      occurred_at: occurredAt.toISOString(),
    })
    .select('id, relationship_id, kind, body, author_clerk_user_id, occurred_at, created_at')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'No se pudo guardar la interacción.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, interaction: data })
}
