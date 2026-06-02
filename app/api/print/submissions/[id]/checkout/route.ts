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
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { startCheckout, type CheckoutProvider } from '@/lib/cart'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import {
  getSellerByClerk,
  getMiyagiprintsSellerId,
  tierOccupancy,
  remainingForTier,
} from '@/lib/print-server'
import { sendPrintAdPaymentPending } from '@/lib/email'
import type { PrintEdition, PrintAdContent } from '@/lib/print'

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

  let body: { provider: CheckoutProvider }
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

  const miyagiprintsSellerId = await getMiyagiprintsSellerId()
  const user = await currentUser()
  const buyerEmail = user?.emailAddresses?.[0]?.emailAddress ?? submission.buyer_email ?? undefined

  const isManual = body.provider === 'manual' || body.provider === 'spei' || body.provider === 'cash'

  // ── Drive the shared checkout flow ────────────────────────────────────────
  let result
  try {
    result = await startCheckout({
      productId: tier.medusa_product_id,
      sellerId: miyagiprintsSellerId ?? undefined,
      provider: body.provider,
      buyerEmail,
      buyerFirstName: user?.firstName ?? undefined,
      buyerLastName: user?.lastName ?? undefined,
      clerkJwt: clerkJwt ?? undefined,
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

  await db
    .from('print_ad_submissions')
    .update({
      status: 'pending_payment',
      buyer_email: buyerEmail ?? null,
      medusa_product_id: tier.medusa_product_id,
      // Persist the manual payment instructions so the buyer can retrieve them anytime.
      ...(isManual ? { content: { ...(submission.content ?? {}), manual_payment: manualSnapshot } } : {}),
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
