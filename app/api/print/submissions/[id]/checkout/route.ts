/**
 * POST /api/print/submissions/[id]/checkout
 *
 * Server-authoritative start of payment for a print-ad placement. Re-checks
 * capacity, then drives the SAME Medusa cart → start-checkout flow every product
 * uses (lib/cart.ts startCheckout) with fulfillment_method 'digital' so card +
 * MercadoPago + manual all work. Stamps cart_id on the submission so the payment
 * webhook can link it back (see app/api/webhooks/{stripe,mercadopago}).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { startCheckout, type CheckoutProvider } from '@/lib/cart'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import {
  getSellerByClerk,
  getPlatformSellerId,
  tierOccupancy,
  remainingForTier,
} from '@/lib/print-server'
import { sendPrintAdPaymentPending } from '@/lib/email'
import type { PrintEdition, PrintAdContent } from '@/lib/print'
import { isEnabled } from '@/lib/flags'
import { getPromoterByCode, getPromoterSettings, resolvePromoterDiscount } from '@/lib/promoter'
import { ensurePromoterPlatformCouponCode } from '@/lib/promoter-coupon-server'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
const fmtMXN = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

const PROVIDERS: CheckoutProvider[] = ['stripe', 'mercadopago', 'manual', 'spei', 'cash']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { provider: CheckoutProvider; couponCode?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  if (!body.provider || !PROVIDERS.includes(body.provider)) {
    return NextResponse.json({ error: 'Método de pago no válido.' }, { status: 400 })
  }

  const clerkJwt = await getToken()
  const seller = clerkJwt ? await getSellerByClerk(clerkJwt) : null
  if (!seller) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  // ── Load submission (owner only) ──────────────────────────────────────────
  const { data: submission } = await db.from('print_ad_submissions').select('*').eq('id', id).single()
  if (!submission) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (submission.seller_id !== seller.id) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })
  if (submission.status !== 'draft' && submission.status !== 'pending_payment') {
    return NextResponse.json({ error: 'Este anuncio ya fue pagado.' }, { status: 422 })
  }

  // ── Re-load edition + tier; re-check capacity ─────────────────────────────
  const { data: edition } = await db
    .from('print_editions').select('*').eq('id', submission.edition_id).single() as { data: PrintEdition | null }
  if (!edition || edition.status !== 'open') {
    return NextResponse.json({ error: 'Esta edición ya no acepta anuncios.' }, { status: 422 })
  }
  const tier = (edition.tiers ?? []).find((t) => t.key === submission.tier_key)
  if (!tier?.medusa_product_id) {
    return NextResponse.json({ error: 'Este tamaño aún no está disponible para compra.' }, { status: 422 })
  }
  // Don't count THIS submission against itself when re-checking.
  const counts = await tierOccupancy(edition.id)
  const selfOccupies = submission.status === 'pending_payment'
  const effective = { ...counts, [tier.key]: Math.max(0, (counts[tier.key] ?? 0) - (selfOccupies ? 1 : 0)) }
  if (remainingForTier(tier, effective) <= 0) {
    return NextResponse.json({ error: 'Este tamaño se agotó.' }, { status: 422 })
  }

  const platformSellerId = await getPlatformSellerId()
  const user = await currentUser()
  const buyerEmail = user?.emailAddresses?.[0]?.emailAddress ?? submission.buyer_email ?? undefined

  const isManual = body.provider === 'manual' || body.provider === 'spei' || body.provider === 'cash'

  // ── Promoter Program (epic 08 · S2) — same one-time cadence + real discount ──
  // A promoter's code (captured to the `promo` cookie from their share link)
  // applies the seller discount as a Medusa platform coupon and attributes the
  // sale to the promoter (resolved server-side — never a client-sent amount).
  let promoterCouponCode: string | undefined
  let promoterId: string | undefined
  let promoterSellerId: string | undefined
  if (await isEnabled('promoter.enabled')) {
    const cookieStore = await cookies()
    const promoCode = (cookieStore.get('promo')?.value ?? '').trim()
    if (promoCode) {
      const [promoter, settings] = await Promise.all([getPromoterByCode(promoCode), getPromoterSettings()])
      const resolved = resolvePromoterDiscount({ promoter, settings, itemsCents: tier.price_cents })
      if (resolved.ok) {
        promoterId = resolved.promoter_id
        // Attribution targets the seller's marketplace shop (consistent with US-3
        // + the custom-domain path: attribution `seller_id` is marketplace_shops.id).
        const { data: shop } = await db
          .from('marketplace_shops')
          .select('id')
          .eq('clerk_user_id', userId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        promoterSellerId = shop?.id ?? undefined
        // Apply the discount only when the buyer didn't type their own coupon.
        if (!body.couponCode) {
          promoterCouponCode = (await ensurePromoterPlatformCouponCode(settings)) ?? undefined
        }
      }
    }
  }

  // ── Drive the shared checkout flow ────────────────────────────────────────
  let result
  try {
    result = await startCheckout({
      productId: tier.medusa_product_id,
      sellerId: platformSellerId ?? undefined,
      provider: body.provider,
      buyerEmail,
      buyerFirstName: user?.firstName ?? undefined,
      buyerLastName: user?.lastName ?? undefined,
      clerkJwt: clerkJwt ?? undefined,
      couponCode: body.couponCode ?? promoterCouponCode,
      fulfillmentMethod: 'digital',
      // Print sends its own payment-pending email (not the generic manual order one).
      suppressManualEmail: true,
    })
  } catch (e) {
    console.error('[print checkout] startCheckout failed:', e)
    return NextResponse.json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' }, { status: 502 })
  }

  // ── Link the order back to the submission ─────────────────────────────────
  // Card (stripe/mp): result.cart_id is the real cart id; the webhook completes it
  //   and stamps medusa_order_id. We store cart_id now so the webhook can find us.
  // Manual: startCheckout completed the cart inline; result.cart_id is the ORDER id.
  //   No webhook fires — the owner confirms payment in the admin console, and the
  //   slot is held meanwhile (pending_payment occupies capacity).
  const manualSnapshot = (result as unknown as {
    manual_payment?: PrintAdContent['manual_payment']
  }).manual_payment ?? null

  // Persist content when there's something to carry: the manual payment snapshot
  // and/or the promoter attribution ids (read by handlePrintAdPaid on the paid event).
  const promoterContent = promoterId && promoterSellerId
    ? { promoter_id: promoterId, promoter_seller_id: promoterSellerId }
    : {}
  const writeContent = isManual || (promoterId && promoterSellerId)
  const nextContent = {
    ...(submission.content ?? {}),
    ...promoterContent,
    ...(isManual ? { manual_payment: manualSnapshot } : {}),
  }

  await db
    .from('print_ad_submissions')
    .update({
      status: 'pending_payment',
      buyer_email: buyerEmail ?? null,
      medusa_product_id: tier.medusa_product_id,
      ...(writeContent ? { content: nextContent } : {}),
      ...(isManual
        ? { medusa_order_id: result.cart_id ?? null }
        : { cart_id: result.cart_id ?? null }),
    })
    .eq('id', id)

  // ── Manual: send the print-specific payment-pending email ─────────────────
  if (isManual && manualSnapshot && buyerEmail) {
    sendPrintAdPaymentPending({
      buyerEmail,
      buyerName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
      editionTitle: edition.title,
      tierLabel: tier.label,
      amountDue: fmtMXN(tier.price_cents),
      manual: manualSnapshot,
      submissionDeadline: edition.submission_deadline,
      manageUrl: `${SITE_URL}/account/print-ads`,
    }).catch((e) => console.error('[print checkout] pending email failed:', e))
  }

  return NextResponse.json(result)
}
