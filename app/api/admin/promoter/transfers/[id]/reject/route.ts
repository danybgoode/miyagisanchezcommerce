/**
 * POST /api/admin/promoter/transfers/:id/reject
 *
 * Rejects a `reported` transfer (atomic `reported → rejected`) with an es-MX
 * reason. No grant write — the sale returns to unpaid. Notifies the promoter by
 * email with the reason. A fresh transfer request may follow (the unique index
 * only blocks concurrent pending/reported rows for the same shop+SKU).
 *
 * Auth: Clerk admin session (via withAdmin). Promoter Funnel v2 · Sprint 4 (US-4.2).
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { rejectPromoterTransfer } from '@/lib/promoter-transfers'
import { getPromoterById } from '@/lib/promoter'
import { TRANSFER_SKU_LABEL } from '@/lib/promoter-transfer'
import { getSellerEmail, sendPromoterTransferRejected } from '@/lib/email'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: { reason?: string } = {}
  try { body = await req.json() } catch { /* reason is optional */ }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  const result = await rejectPromoterTransfer(id, reason)
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'not_found' ? 404 : 409 })
  }
  const transfer = result.transfer

  const promoter = await getPromoterById(transfer.promoter_id)
  if (promoter?.clerk_user_id) {
    const email = await getSellerEmail(promoter.clerk_user_id)
    if (email) {
      sendPromoterTransferRejected({
        to: email,
        skuLabel: TRANSFER_SKU_LABEL[transfer.sku],
        reason: transfer.rejected_reason,
      }).catch((e) => console.error('[promoter-transfers] rejected email failed:', e))
    }
  }

  return NextResponse.json({ ok: true, transfer })
})
