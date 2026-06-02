/**
 * POST /api/print/submissions/[id]/payment-reported
 * Buyer signals they've sent a manual (SPEI/DiMo/cash) payment. Flags the
 * submission and pings the admin to verify + confirm in the console.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getSellerByClerk } from '@/lib/print-server'
import { tgNotify } from '@/lib/telegram'
import { sendPrintPaymentReportedToMiyagi, sendPrintPaymentReportedToBuyer } from '@/lib/email'
import type { PrintEdition } from '@/lib/print'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
const fmtMXN = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const jwt = await getToken()
  const seller = jwt ? await getSellerByClerk(jwt) : null
  if (!seller) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  const { data: sub } = await db.from('print_ad_submissions').select('*').eq('id', id).single()
  if (!sub) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (sub.seller_id !== seller.id) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })
  if (sub.status !== 'pending_payment') return NextResponse.json({ error: 'Este anuncio no está pendiente de pago.' }, { status: 422 })

  await db.from('print_ad_submissions')
    .update({ content: { ...(sub.content ?? {}), payment_reported: true, payment_reported_at: new Date().toISOString() } })
    .eq('id', id)

  tgNotify(`💸 Edición impresa: ${sub.buyer_email ?? seller.name} reporta pago — verificar y confirmar en /admin/print (anuncio ${id})`).catch(() => {})

  // ── Notify admin + acknowledge to buyer (best-effort) ─────────────────────
  const { data: edition } = await db
    .from('print_editions').select('title, tiers').eq('id', sub.edition_id).single() as { data: Pick<PrintEdition, 'title' | 'tiers'> | null }
  const tier = (edition?.tiers ?? []).find((t) => t.key === sub.tier_key)
  const editionTitle = edition?.title ?? 'Edición impresa'
  const tierLabel = tier?.label ?? sub.tier_key

  const adminEmail = process.env.MIYAGI_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? null
  if (adminEmail) {
    sendPrintPaymentReportedToMiyagi({
      adminEmail, editionTitle, tierLabel,
      buyerEmail: sub.buyer_email ?? null,
      amount: tier ? fmtMXN(tier.price_cents) : null,
      adminUrl: `${SITE_URL}/admin/print`,
    }).catch((e) => console.error('[payment-reported] admin email:', e))
  }
  if (sub.buyer_email) {
    sendPrintPaymentReportedToBuyer({
      buyerEmail: sub.buyer_email, editionTitle, manageUrl: `${SITE_URL}/account/print-ads`,
    }).catch((e) => console.error('[payment-reported] buyer email:', e))
  }

  return NextResponse.json({ ok: true })
}
