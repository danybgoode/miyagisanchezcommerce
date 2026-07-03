/**
 * POST /api/promoter/close/transfer/[id]/report — "Ya transferí". Flips a
 * `pending` transfer to `reported` (idempotent re-tap). Never activates
 * anything — no grant write here, per the acceptance bar (US-4.1).
 *
 * Auth: Clerk session + bound promoter, same as the other `/api/promoter/close/*`
 * routes. Ownership-checked: a promoter may only report THEIR OWN transfer.
 * Promoter Funnel v2 · Sprint 4 (US-4.1).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId } from '@/lib/promoter'
import { getPromoterTransferById, reportPromoterTransfer } from '@/lib/promoter-transfers'
import { tg } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled('promoter.enabled')) || !(await isEnabled('promoter.transfer_enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  const { id } = await params
  const existing = await getPromoterTransferById(id)
  if (!existing || existing.promoter_id !== promoter.id) {
    return NextResponse.json({ ok: false, error: 'Transferencia no encontrada.' }, { status: 404 })
  }

  const result = await reportPromoterTransfer(id)
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason === 'not_found' ? 'Transferencia no encontrada.' : 'Esta transferencia ya fue procesada.' },
      { status: result.reason === 'not_found' ? 404 : 409 },
    )
  }

  tg.alert(
    `💸 Transferencia reportada — pendiente de aprobación.\n` +
    `Promotor: ${promoter.code}\nSKU: ${result.transfer.sku}\nMonto: $${(result.transfer.owed_cents / 100).toFixed(2)} MXN`,
  )

  return NextResponse.json({ ok: true, transfer: result.transfer })
}
