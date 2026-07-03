/**
 * GET /api/promoter/close/transfer?shopId=&sku= — the shop+SKU's currently
 * active (pending/reported) transfer, if any. Lets the close-workspace UI
 * restore state after a reload (a promoter mid-close who refreshes the page
 * shouldn't lose the "transferencia reportada — pendiente de aprobación" state).
 *
 * Auth: Clerk session + bound promoter, same as the other `/api/promoter/close/*`
 * routes. Ownership-checked: only returns a transfer belonging to THIS promoter.
 * Promoter Funnel v2 · Sprint 4 (US-4.1).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId } from '@/lib/promoter'
import { isTransferSku } from '@/lib/promoter-transfer'
import { getActivePromoterTransfer } from '@/lib/promoter-transfers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled')) || !(await isEnabled('promoter.transfer_enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  const shopId = req.nextUrl.searchParams.get('shopId') ?? ''
  const sku = req.nextUrl.searchParams.get('sku') ?? ''
  if (!shopId || !isTransferSku(sku)) {
    return NextResponse.json({ ok: false, error: 'Datos inválidos.' }, { status: 400 })
  }

  const transfer = await getActivePromoterTransfer(shopId, sku)
  if (transfer && transfer.promoter_id !== promoter.id) {
    // Belongs to a different promoter — never leak another promoter's transfer.
    return NextResponse.json({ ok: true, transfer: null })
  }
  return NextResponse.json({ ok: true, transfer })
}
