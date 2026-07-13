/**
 * POST /api/mp/subscription-checkout
 *
 * Creates a MercadoPago preapproval (subscription) for a buyer.
 * If the listing already has a preapproval plan ID stored, it is reused.
 * Otherwise a new plan is created and stored in listing metadata.
 *
 * Body: { listingId: string; tierId?: string }
 * Returns: { url: string }  — buyer redirects to this init_point
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { createMpPreapprovalPlan, createMpPreapproval } from '@/lib/mercadopago'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { resolveOrigin } from '@/lib/request-origin'

export async function POST(req: NextRequest) {
  // ── Auth required — subscriptions need buyer identity for lifecycle management ──
  const clerkUser = await currentUser()
  if (!clerkUser) {
    return NextResponse.json(
      { error: 'Debes iniciar sesión para suscribirte.', code: 'AUTH_REQUIRED' },
      { status: 401 },
    )
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let body: { listingId?: string; tierId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  if (!body.listingId) {
    return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })
  }

  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, currency, listing_type, status, metadata, shop_id')
    .eq('id', body.listingId)
    .eq('status', 'active')
    .maybeSingle()

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado o no disponible.' }, { status: 404 })
  }
  if (listing.listing_type !== 'subscription') {
    return NextResponse.json({ error: 'Este anuncio no es una suscripción.' }, { status: 422 })
  }

  const meta = (listing.metadata ?? {}) as Record<string, unknown>

  // ── Resolve tier ──────────────────────────────────────────────────────────
  type StoredTier = {
    id: string; label: string; price_cents: number; interval: string
    mp_preapproval_plan_id?: string
  }

  let tierPriceCents: number
  let tierInterval: 'months' | 'days'
  let tierId: string | undefined
  let storedPlanId: string | undefined
  let tierLabel: string

  const tiers = meta.subscription_tiers as StoredTier[] | undefined

  if (tiers && tiers.length > 0) {
    // Multi-tier listing — find the requested tier (or default to first)
    const tier = body.tierId ? tiers.find(t => t.id === body.tierId) : tiers[0]
    if (!tier) return NextResponse.json({ error: 'Plan no encontrado.' }, { status: 404 })
    tierPriceCents = tier.price_cents
    tierInterval   = tier.interval === 'year' ? 'months' : 'months'
    tierId         = tier.id
    storedPlanId   = tier.mp_preapproval_plan_id
    tierLabel      = tier.label
  } else {
    // Phase A single-tier fallback
    const subMeta = (meta.subscription ?? {}) as Record<string, unknown>
    tierPriceCents = listing.price_cents ?? 0
    tierInterval   = 'months'
    tierId         = undefined
    storedPlanId   = subMeta.mp_preapproval_plan_id as string | undefined
    tierLabel      = 'Suscripción'
  }

  if (!tierPriceCents || tierPriceCents <= 0) {
    return NextResponse.json({ error: 'Precio no configurado.' }, { status: 422 })
  }

  const currency = (listing.currency ?? 'MXN').toUpperCase()
  // MP preapproval amounts for annual billing: bill monthly at price/12
  // (MP preapproval_plan doesn't natively support annual, so we bill 12× monthly)
  const isAnnual = tiers?.find(t => t.id === tierId)?.interval === 'year'
  const monthlyAmountCents = isAnnual ? Math.round(tierPriceCents / 12) : tierPriceCents

  const buyerEmail = clerkUser.emailAddresses?.[0]?.emailAddress

  let origin: string
  try {
    origin = resolveOrigin({ siteUrl: process.env.NEXT_PUBLIC_SITE_URL, host: req.headers.get('host') })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo iniciar el pago.' }, { status: 500 })
  }

  // ── Get or create preapproval plan (idempotent) ───────────────────────────
  let planId = storedPlanId
  if (!planId) {
    let newPlanId: string
    try {
      const result = await createMpPreapprovalPlan({
        title: `${listing.title}${tierLabel !== 'Suscripción' ? ` — ${tierLabel}` : ''}`,
        priceCents: monthlyAmountCents,
        currency,
        frequency: 1,
        frequencyType: 'months',
      })
      newPlanId = result.planId
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[mp-sub] createMpPreapprovalPlan failed:', msg)
      return NextResponse.json(
        { error: 'No se pudo crear el plan de suscripción con MercadoPago. Verifica que el token tenga permisos de suscripciones.', detail: msg },
        { status: 502 },
      )
    }
    planId = newPlanId

    // Persist plan ID in listing metadata so future buyers reuse it
    if (tiers && tierId) {
      const updatedTiers = tiers.map(t =>
        t.id === tierId ? { ...t, mp_preapproval_plan_id: planId } : t,
      )
      await db.from('marketplace_listings')
        .update({ metadata: { ...meta, subscription_tiers: updatedTiers } })
        .eq('id', listing.id)
    } else {
      const subMeta = (meta.subscription ?? {}) as Record<string, unknown>
      await db.from('marketplace_listings')
        .update({ metadata: { ...meta, subscription: { ...subMeta, mp_preapproval_plan_id: planId } } })
        .eq('id', listing.id)
    }
  }

  // ── Create buyer preapproval instance ─────────────────────────────────────
  let preapprovalId: string
  let initPoint: string
  try {
    const result = await createMpPreapproval({
      planId,
      title: `${listing.title}${tierLabel !== 'Suscripción' ? ` — ${tierLabel}` : ''}`,
      priceCents: monthlyAmountCents,
      currency,
      frequency: 1,
      frequencyType: 'months',
      buyerEmail,
      listingId: listing.id,
      shopId: listing.shop_id,
      tierId,
      origin,
    })
    preapprovalId = result.preapprovalId
    initPoint = result.initPoint
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mp-sub] createMpPreapproval failed:', msg)
    return NextResponse.json(
      { error: 'No se pudo iniciar la suscripción con MercadoPago.', detail: msg },
      { status: 502 },
    )
  }

  // ── Store pending subscription record ─────────────────────────────────────
  // Insert subscription record — ignore conflict on mp_preapproval_id (idempotent)
  const { error: insertErr } = await db.from('marketplace_subscriptions').insert({
    listing_id: listing.id,
    shop_id: listing.shop_id,
    buyer_clerk_user_id: clerkUser.id,
    buyer_email: (buyerEmail ?? '').toLowerCase().trim(),
    payment_method: 'mercadopago',
    status: 'pending_authorization',
    tier_id: tierId ?? null,
    mp_preapproval_id: preapprovalId,
    mp_preapproval_plan_id: planId,
    metadata: { tier_id: tierId ?? null, is_annual: isAnnual },
  })
  // If there's a unique constraint violation it's a duplicate — safe to ignore
  if (insertErr && !insertErr.message.includes('unique') && !insertErr.message.includes('duplicate')) {
    console.error('[mp-sub] insert error:', insertErr)
  }

  return NextResponse.json({ url: initPoint })
}
