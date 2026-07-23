/**
 * POST /api/promoter/relationship/[id]/task — set a dated next action on a
 * relationship (founding-merchant-activation-ops S2.2). "The next action" the
 * operating views show is the earliest-due OPEN task
 * (`lib/relationship-pipeline.ts#nextOpenTask`) — this route only ever
 * CREATES a new task row; nothing here marks one complete (that's
 * `POST .../task/[taskId]/complete`) and nothing here deletes one.
 *
 * Scope-checked through the ONE shared helper (`resolveRelationshipAccess`);
 * a `viewer` partner-grant may READ but not WRITE (`canWriteRelationship`).
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 *
 * C8 fix (PR 304 review): a date-only `dueAt` (what `<input type="date">`
 * sends) is interpreted as end-of-day AMÉRICA/MEXICO_CITY, not UTC midnight
 * — see `lib/relationship-pipeline.ts#dueAtIsoFromDateOnly`'s header for why
 * `new Date("2026-07-23")` was wrong (renders a day early in es-MX, goes
 * overdue hours before the day even starts).
 *
 * C9 fix (PR 304 review): `title`/`dueAt`/`assignedTo` are now runtime
 * type-checked BEFORE any string method touches them — a non-string value
 * (`{title: 123}`) used to reach `.trim()`/`.filter()`-shaped code and 500;
 * it now 400s like any other malformed field.
 *
 * D3e fix (PR 304 review, round 3): a `dueAt` shaped like `YYYY-MM-DD` but
 * NOT a real calendar date (`2026-02-31`) now 400s instead of silently
 * falling through to `new Date(...)`'s own roll-over behavior (which is
 * JUST as lenient as the date-only helper's — bare `new Date("2026-02-31")`
 * also rolls to March, it isn't a safety net). `isDateOnlyShape` is what
 * lets this route tell "date-only but invalid" (reject) apart from "not
 * date-only at all, e.g. a full ISO datetime" (fall back to generic
 * parsing) — `dueAtIsoFromDateOnly` alone returns `null` for both, on
 * purpose, since only the CALLER knows which fallback is appropriate.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { authorizeRelationshipRequest, resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'
import { dueAtIsoFromDateOnly, isDateOnlyShape } from '@/lib/relationship-pipeline'

export const dynamic = 'force-dynamic'

interface TaskBody {
  title?: string
  dueAt?: string
  assignedTo?: string
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
        error: 'Tu acceso a este registro es de solo lectura (viewer) — crear una acción requiere el rol manager.',
      },
      { status: 403 },
    )
  }

  let body: TaskBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  if (body.title !== undefined && typeof body.title !== 'string') {
    return NextResponse.json({ ok: false, error: 'Título inválido.' }, { status: 400 })
  }
  const title = (body.title ?? '').trim()
  if (!title) {
    return NextResponse.json({ ok: false, error: 'El título de la acción es obligatorio.' }, { status: 400 })
  }

  let dueAt: string | null = null
  if (body.dueAt !== undefined && body.dueAt !== '') {
    if (typeof body.dueAt !== 'string') {
      return NextResponse.json({ ok: false, error: 'Fecha límite inválida.' }, { status: 400 })
    }
    // Date-only ("YYYY-MM-DD", what <input type="date"> sends) → end of day
    // in Mexico City (C8), REJECTING a shape-valid but calendar-invalid date
    // (D3e) rather than falling through; anything else parses as a normal
    // ISO instant.
    if (isDateOnlyShape(body.dueAt)) {
      const dateOnly = dueAtIsoFromDateOnly(body.dueAt)
      if (!dateOnly) {
        return NextResponse.json({ ok: false, error: 'Fecha límite inválida.' }, { status: 400 })
      }
      dueAt = dateOnly
    } else {
      const d = new Date(body.dueAt)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ ok: false, error: 'Fecha límite inválida.' }, { status: 400 })
      }
      dueAt = d.toISOString()
    }
  }

  if (body.assignedTo !== undefined && typeof body.assignedTo !== 'string') {
    return NextResponse.json({ ok: false, error: 'Asignado inválido.' }, { status: 400 })
  }
  // Defaults to the caller — an action always has SOMEONE assigned, even when
  // the UI doesn't ask (build contract: "every active merchant is either
  // scheduled or visibly missing an action" — an assignee-less open task
  // would still count as scheduled but leave no one accountable for it).
  const assignedTo = (body.assignedTo ?? '').trim() || auth.user.id

  const { data, error } = await db
    .from('merchant_relationship_tasks')
    .insert({
      relationship_id: id,
      title,
      due_at: dueAt,
      assigned_to: assignedTo,
      created_by: auth.user.id,
    })
    .select('id, relationship_id, title, due_at, assigned_to, completed_at, completed_by, created_by, created_at')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'No se pudo guardar la acción.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, task: data })
}
