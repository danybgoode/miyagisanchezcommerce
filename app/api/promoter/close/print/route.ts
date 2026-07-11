/**
 * POST /api/promoter/close/print — a bound promoter buys a printed-ad placement on
 * a MERCHANT'S behalf (epic 08 · S4 · US-10). Consolidates the seller-self
 * create-draft (`/api/print/submissions`) + checkout (`/api/print/submissions/[id]/
 * checkout`) into ONE promoter-authed call for the in-store close: the promoter
 * picks edition + tier, the submission is created against the MERCHANT'S Medusa
 * seller (not the promoter's), and the promoter pays — with their own card, or
 * "cash-reported" (manual) when they collected cash. Attribution targets the
 * merchant's mirror shop (survives the later claim) + is flagged paid-by-promoter.
 *
 * Self-checkout routes are untouched; this is additive + isolated. Clerk- +
 * `promoter.enabled`-gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { startCheckout, type CheckoutProvider } from '@/lib/cart'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { tg } from '@/lib/telegram'
import { getPlatformSellerId, tierOccupancy, remainingForTier } from '@/lib/print-server'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId, getPromoterSettings, resolvePromoterDiscount } from '@/lib/promoter'
import { ensurePromoterPlatformCouponCode } from '@/lib/promoter-coupon-server'
import { resolveTargetShop } from '@/lib/promoter-server'
import { PAID_BY_PROMOTER_FLAG } from '@/lib/promoter-close'
import type { PrintEdition, PrintAdContent } from '@/lib/print'

export const dynamic = 'force-dynamic'

// Card rails charge the promoter's card now (webhook → handlePrintAdPaid accrues);
// cash/manual hold the slot as pending_payment + flag payment_reported (the admin
// confirms offline → markAttributionPaid in the admin PATCH accrues then).
const PROVIDERS: CheckoutProvider[] = ['stripe', 'mercadopago', 'cash', 'spei', 'manual']

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(userId)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  let body: { shopId?: string; slug?: string; editionId?: string; tierKey?: string; provider?: CheckoutProvider; content?: PrintAdContent; is2x1?: boolean } = {}
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Datos inválidos.' }, { status: 400 }) }
  if (!body.provider || !PROVIDERS.includes(body.provider)) {
    return NextResponse.json({ ok: false, error: 'Método de pago no válido.' }, { status: 400 })
  }
  if (!body.editionId || !body.tierKey) {
    return NextResponse.json({ ok: false, error: 'Falta la edición o el tamaño.' }, { status: 400 })
  }

  const shop = await resolveTargetShop({ shopId: body.shopId, slug: body.slug })
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })
  if (!shop.medusaSellerId) {
    return NextResponse.json({ ok: false, error: 'La tienda no tiene un vendedor válido.' }, { status: 422 })
  }

  // ── Validate edition open + tier exists + has capacity ────────────────────
  const { data: edition } = await db
    .from('print_editions').select('*').eq('id', body.editionId).single() as { data: PrintEdition | null }
  if (!edition || edition.status !== 'open') {
    return NextResponse.json({ ok: false, error: 'Esta edición ya no acepta anuncios.' }, { status: 422 })
  }
  const tier = (edition.tiers ?? []).find((t) => t.key === body.tierKey)
  if (!tier?.medusa_product_id) {
    return NextResponse.json({ ok: false, error: 'Este tamaño aún no está disponible.' }, { status: 422 })
  }
  const counts = await tierOccupancy(edition.id)
  if (remainingForTier(tier, counts) <= 0) {
    return NextResponse.json({ ok: false, error: 'Este tamaño se agotó.' }, { status: 422 })
  }

  // ── Create the draft submission for the MERCHANT'S seller ──────────────────
  const { data: submission, error: subErr } = await db
    .from('print_ad_submissions')
    .insert({
      edition_id: edition.id,
      tier_key: tier.key,
      seller_id: shop.medusaSellerId,     // the merchant's Medusa seller (not the promoter)
      buyer_clerk_user_id: userId,         // the promoter is the payer
      buyer_email: null,
      medusa_product_id: tier.medusa_product_id,
      status: 'draft',
      // Sprint 3 (US-3.3) — a 2x1 close (pay 1 edition, appear in 2) is stamped
      // here so maybeClone2x1Submission (lib/print-server.ts) picks it up once paid.
      content: { ...(body.content ?? {}), ...(body.is2x1 ? { is_2x1: true } : {}) },
    })
    .select('*')
    .single()
  if (subErr || !submission) {
    return NextResponse.json({ ok: false, error: 'No se pudo crear el anuncio.' }, { status: 500 })
  }

  // ── Promoter discount (server-side) — the merchant's mirror is the target ──
  const settings = await getPromoterSettings()
  const resolved = resolvePromoterDiscount({ promoter, settings, itemsCents: tier.price_cents })
  const promoterCouponCode = resolved.ok ? (await ensurePromoterPlatformCouponCode(settings)) ?? undefined : undefined

  const user = await currentUser().catch(() => null)
  const buyerEmail = user?.emailAddresses?.[0]?.emailAddress ?? undefined
  const clerkJwt = await getToken()
  const platformSellerId = await getPlatformSellerId()
  const isManual = body.provider === 'manual' || body.provider === 'spei' || body.provider === 'cash'

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
      couponCode: promoterCouponCode,
      fulfillmentMethod: 'digital',
      suppressManualEmail: true,
    })
  } catch (e) {
    console.error('[promoter/close/print] startCheckout failed:', e)
    return NextResponse.json({ ok: false, error: 'No se pudo iniciar el pago.' }, { status: 502 })
  }

  // ── Stamp provenance + attribution onto the submission ────────────────────
  const manualSnapshot = (result as unknown as { manual_payment?: PrintAdContent['manual_payment'] }).manual_payment ?? null
  const nextContent: Record<string, unknown> = {
    ...(submission.content ?? {}),
    promoter_id: promoter.id,
    promoter_seller_id: shop.id,            // the mirror UUID — the attribution key
    paid_by_promoter: PAID_BY_PROMOTER_FLAG,
    ...(isManual ? { manual_payment: manualSnapshot, payment_reported: true, payment_reported_at: new Date().toISOString() } : {}),
  }

  // The stamp is load-bearing: the card webhook (handlePrintAdPaid) finds the
  // submission by cart_id and reads content.promoter_* for attribution. A silent
  // failure here would lose the link AFTER the promoter pays — verify the write
  // landed (error OR 0 rows) and refuse + alert instead of a false ok:true.
  const { data: stamped, error: stampErr } = await db
    .from('print_ad_submissions')
    .update({
      status: 'pending_payment',
      buyer_email: buyerEmail ?? null,
      content: nextContent,
      ...(isManual ? { medusa_order_id: result.cart_id ?? null } : { cart_id: result.cart_id ?? null }),
    })
    .eq('id', submission.id)
    .select('id')
  if (stampErr || !stamped || stamped.length === 0) {
    console.error('[promoter/close/print] submission stamp failed:', stampErr?.message ?? '0 rows')
    tg.alert(
      `🚨 Anuncio impreso (promotor) NO vinculado tras el checkout — reparar a mano.\n` +
      `Submission: ${submission.id}\nCart: ${result.cart_id ?? '?'}\nPromotor: ${promoter.code}`,
    )
    return NextResponse.json({ ok: false, error: 'El pago se inició pero no se registró. Avísale al equipo.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, submissionId: submission.id, ...result })
}
