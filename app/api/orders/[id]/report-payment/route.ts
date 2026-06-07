/**
 * POST /api/orders/[id]/report-payment
 *
 * Buyer presses "Ya hice el pago" on a manual (SPEI/cash/DiMo) order. Three effects:
 *   1. Durably persists `buyer_reported_paid` on the Medusa order (the authoritative
 *      side-effect, #3b) so the state survives reload and both sides + agents read it.
 *   2. Notifies the SELLER through the preference seam (Pagos group) — email + push
 *      + their linked Telegram, per their settings (Granular Notifications S3.1).
 *   3. Pings the admin channel — best-effort observability nudge.
 * The authoritative confirmation is still the seller's "Confirmar pago recibido"
 * (which captures the payment).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { tgNotify, escapeHtml } from '@/lib/telegram'
import { dispatchToSeller } from '@/lib/notifications/dispatch'
import { sendBuyerReportedPaymentToSeller } from '@/lib/email'
import { db } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

/**
 * Resolve the seller (clerk_user_id + listing title) for an order so the
 * "buyer reported payment" event can reach them via the preference seam. The
 * route is buyer-authed, so we resolve the seller from the order itself. Reuses
 * the same shapes the return-request route reads. Best-effort: returns null when
 * it can't resolve (the durable persist + admin nudge still happen regardless).
 */
async function resolveSellerForOrder(
  id: string,
  clerkJwt: string | null,
): Promise<{ clerkUserId: string; listingTitle: string } | null> {
  // Medusa-backed order — the embedded marketplace_* shape (same as return-request).
  if (id.startsWith('order_')) {
    if (!clerkJwt) return null
    try {
      const res = await fetch(`${MEDUSA_BASE}/store/buyer/me/orders/${id}`, {
        headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
      })
      if (res.ok) {
        const data = (await res.json()) as {
          order?: {
            marketplace_shops?: { clerk_user_id?: string }
            marketplace_listings?: { title?: string }
          }
        }
        const cid = data.order?.marketplace_shops?.clerk_user_id
        if (cid) return { clerkUserId: cid, listingTitle: data.order?.marketplace_listings?.title ?? 'tu pedido' }
      }
    } catch {
      /* fall through → null */
    }
    return null
  }

  // Legacy Supabase order mirror.
  try {
    const { data: order } = await db
      .from('marketplace_orders')
      .select('marketplace_shops!inner(clerk_user_id), marketplace_listings!inner(title)')
      .eq('id', id)
      .maybeSingle()
    const shop = order?.marketplace_shops as unknown as { clerk_user_id: string | null } | undefined
    const listing = order?.marketplace_listings as unknown as { title: string } | undefined
    if (shop?.clerk_user_id) return { clerkUserId: shop.clerk_user_id, listingTitle: listing?.title ?? 'tu pedido' }
  } catch {
    /* ignore — best-effort */
  }
  return null
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const clerkJwt = await getToken()

  // ── Durable persist on the Medusa order (the authoritative effect) ──────────
  // Medusa-backed orders carry an "order_" id. Surface a real failure to the buyer
  // (their click must stick); legacy/non-Medusa ids fall through to the nudge only.
  if (id.startsWith('order_')) {
    try {
      const res = await fetch(`${MEDUSA_BASE}/store/buyer/me/orders/${id}/report-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
        },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        return NextResponse.json(
          { error: data.message ?? 'No se pudo registrar tu aviso de pago.' },
          { status: res.status },
        )
      }
    } catch {
      return NextResponse.json({ error: 'Sin conexión. Inténtalo de nuevo.' }, { status: 502 })
    }
  }

  const user = await currentUser()
  const buyerEmail = user?.emailAddresses?.[0]?.emailAddress ?? null

  // ── Seller notification through the preference seam (Pagos group) ───────────
  // email + push + linked Telegram, respecting the seller's per-channel prefs.
  // Default-on for email/push → today's behaviour is preserved; Telegram is opt-in.
  const seller = await resolveSellerForOrder(id, clerkJwt)
  if (seller) {
    const orderUrl = `${SITE_URL}/shop/manage/orders/${id}`
    void dispatchToSeller(seller.clerkUserId, {
      group: 'payments',
      email: (to) =>
        sendBuyerReportedPaymentToSeller({ sellerEmail: to, listingTitle: seller.listingTitle, buyerEmail, orderUrl }),
      push: {
        kind: 'order',
        title: 'El comprador avisó que pagó',
        body: `${seller.listingTitle} — verifica y confirma`,
        url: orderUrl,
      },
      telegram:
        `💸 <b>El comprador avisó que pagó</b>\n${escapeHtml(seller.listingTitle)}\n` +
        (buyerEmail ? `Comprador: ${escapeHtml(buyerEmail)}\n` : '') +
        `Verifica el depósito y confírmalo en tu panel.`,
    })
  }

  // ── Best-effort admin observability nudge (unchanged surface) ───────────────
  tgNotify(
    `💸 Pedido ${id}: ${buyerEmail ?? 'comprador'} avisa que ya hizo el pago (pago directo) — verifica y confírmalo en el panel del vendedor.`,
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
