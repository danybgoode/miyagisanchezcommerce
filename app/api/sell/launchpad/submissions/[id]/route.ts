/**
 * PATCH /api/sell/launchpad/submissions/[id] — the shop moves a submission
 * through curation (submitted → in_review → approved / rejected /
 * changes_requested), emailing the writer on the transition
 * (bookshop-launchpad S1.2). Ownership is enforced in `transitionSubmission`
 * (the update is scoped to the caller's shop_id). Behind `launchpad.enabled`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopForClerk, transitionSubmission } from '@/lib/launchpad'
import { REVIEWABLE_TARGET_STATUSES, type SubmissionStatus } from '@/lib/launchpad-types'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  if (!(await isEnabled('launchpad.enabled'))) return NextResponse.json({ error: 'No disponible.' }, { status: 423 })

  const shop = await getLaunchpadShopForClerk(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { id } = await params
  let body: { status?: string; note?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const to = body.status as SubmissionStatus | undefined
  if (!to || !REVIEWABLE_TARGET_STATUSES.includes(to)) {
    return NextResponse.json({ error: 'Estado no válido.' }, { status: 422 })
  }

  const result = await transitionSubmission({ shop, id, to, note: body.note })
  if (!result.ok) {
    const msg = result.error === 'note_required'
      ? 'Escribe un mensaje para el autor (obligatorio al rechazar o pedir cambios).'
      : result.error === 'invalid_transition'
      ? 'Ese cambio de estado no es válido.'
      : result.error === 'not_found'
      ? 'Manuscrito no encontrado.'
      : 'No se pudo actualizar.'
    return NextResponse.json({ error: msg }, { status: result.status })
  }

  return NextResponse.json({ submission: { id: result.submission.id, status: result.submission.status, review_note: result.submission.review_note } })
}
