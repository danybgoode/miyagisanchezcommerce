/**
 * PATCH /api/partner/relationship/[id]/draft/[draftId] — save the human's
 * edit to a generated draft (Merchant Partner lifecycle · Sprint 2, Story
 * 2.1). "Generated text is visibly editable" — this route is what persists
 * that edit; it never composes or re-generates anything.
 *
 * GATES: identical to the generate route (flag → Clerk → rate limit → scope
 * → write role). Scoped by BOTH the relationship id and the draft id — a
 * draft id from a different relationship can never be edited through this
 * URL (`lib/portfolio/draft-server.ts#saveDraftEdit`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizePortfolioRequest } from '@/lib/portfolio/gate-server'
import { resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'
import { saveDraftEdit } from '@/lib/portfolio/draft-server'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error

  const { id, draftId } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json({ ok: false, error: 'No tienes permiso de escritura sobre este comercio.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }
  const editedText = (body as { editedText?: unknown } | null)?.editedText
  if (typeof editedText !== 'string') {
    return NextResponse.json({ ok: false, error: 'Falta el texto editado.' }, { status: 400 })
  }

  const result = await saveDraftEdit(id, draftId, editedText)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true, draft: { id: result.id, editedText: result.editedText } })
}
