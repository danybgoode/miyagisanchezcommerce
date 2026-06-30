/**
 * POST /api/promoter/me/bind — bind the logged-in Clerk user to a PRM- code.
 *
 * Promoters are admin-provisioned rows (the S1 console). To operate the authed
 * close workspace (epic 08 · S4 — pay on a seller's behalf, set up shops, hand
 * off claims) a real person logs in once and binds their code: an idempotent,
 * one-time `clerk_user_id` stamp. Gated by `promoter.enabled` (404 when off).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { bindPromoterClerkId } from '@/lib/promoter'

export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, string> = {
  not_found: 'Código de promotor no válido.',
  code_taken: 'Ese código ya está vinculado a otra cuenta.',
  user_taken: 'Tu cuenta ya está vinculada a otro código de promotor.',
  error: 'No se pudo vincular. Intenta de nuevo.',
}

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  let body: { code?: string } = {}
  try { body = await req.json() } catch { /* empty body → no code */ }
  const code = (body.code ?? '').trim()
  if (!code) return NextResponse.json({ ok: false, error: 'Ingresa tu código de promotor.' }, { status: 400 })

  const result = await bindPromoterClerkId(code, user.id)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: MESSAGES[result.reason] ?? MESSAGES.error }, { status: 422 })
  }
  return NextResponse.json({
    ok: true,
    alreadyBound: result.alreadyBound,
    promoter: { code: result.promoter.code, name: result.promoter.name },
  })
}
