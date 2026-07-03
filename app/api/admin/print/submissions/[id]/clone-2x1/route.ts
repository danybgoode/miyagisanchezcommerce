/**
 * POST /api/admin/print/submissions/[id]/clone-2x1  (Clerk admin-gated via withAdmin)
 *
 * Promoter Funnel v2 · Sprint 3 (US-3.3) — the admin-manual fallback for a 2x1
 * sale whose automatic clone couldn't find an eligible next edition
 * (`content.is_2x1_needs_manual_clone`, stamped by `maybeClone2x1Submission`).
 * The admin picks the target edition explicitly ({ targetEditionId }); this
 * reuses the exact same insert `lib/print-server.ts` uses for the automatic path
 * (`cloneSubmissionInto2x1Edition`) — one write, two entry points.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'
import { cloneSubmissionInto2x1Edition } from '@/lib/print-server'
import { canManuallyClone } from '@/lib/promoter-print-2x1'
import type { PrintAdSubmission } from '@/lib/print'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: { targetEditionId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  if (!body.targetEditionId) return NextResponse.json({ error: 'Falta la edición de destino.' }, { status: 400 })

  const { data: submission } = await db
    .from('print_ad_submissions')
    .select('*')
    .eq('id', id)
    .maybeSingle() as { data: PrintAdSubmission | null }
  if (!submission) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (!canManuallyClone(submission.content ?? {})) {
    return NextResponse.json({ error: 'Este anuncio no es 2x1, o ya tiene un clon.' }, { status: 422 })
  }

  const result = await cloneSubmissionInto2x1Edition(submission, body.targetEditionId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  return NextResponse.json({ ok: true, cloneId: result.cloneId })
})
