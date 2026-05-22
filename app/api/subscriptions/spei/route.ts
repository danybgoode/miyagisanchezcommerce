/**
 * POST /api/subscriptions/spei
 * Creates a SPEI subscription in `pending_confirmation` status.
 * The seller receives a Telegram notification and manually confirms
 * receipt of payment at /shop/manage/subscriptions.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'
import { formatOfferAmount } from '@/lib/offers'

interface SpeiSubscriptionBody {
  listingId: string
  buyerName: string
  buyerEmail: string
}

export async function POST(req: NextRequest) {
  let body: SpeiSubscriptionBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const { listingId, buyerName, buyerEmail } = body

  if (!listingId) return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })
  if (!buyerName?.trim() || buyerName.trim().length < 2)
    return NextResponse.json({ error: 'Nombre inválido.', field: 'buyerName' }, { status: 422 })
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail))
    return NextResponse.json({ error: 'Correo inválido.', field: 'buyerEmail' }, { status: 422 })

  // ── Fetch listing + shop (need CLABE from settings) ───────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select(`
      id, title, price_cents, currency, listing_type, status, metadata,
      marketplace_shops!inner(id, name, metadata, clerk_user_id)
    `)
    .eq('id', listingId)
    .eq('status', 'active')
    .maybeSingle()

  if (!listing) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (listing.listing_type !== 'subscription')
    return NextResponse.json({ error: 'Este anuncio no es una suscripción.' }, { status: 422 })

  const shop = listing.marketplace_shops as unknown as {
    id: string
    name: string
    metadata: Record<string, unknown> | null
    clerk_user_id: string | null
  }
  const shopSettings = ((shop.metadata?.settings ?? {}) as Record<string, unknown>)
  // CLABE is stored under settings.checkout.bank_transfer (set in ShopSettings.tsx)
  const checkout = (shopSettings.checkout ?? {}) as Record<string, unknown>
  const bankTransfer = (checkout.bank_transfer ?? {}) as Record<string, unknown>
  const clabe = (bankTransfer.clabe as string | undefined)?.trim() || undefined
  const bankName = (bankTransfer.bank_name as string | undefined)?.trim() || undefined
  const accountHolder = (bankTransfer.account_holder as string | undefined)?.trim() || undefined

  // ── Check for duplicate pending subscription ──────────────────────────────
  const { data: existing } = await db
    .from('marketplace_subscriptions')
    .select('id, status')
    .eq('listing_id', listingId)
    .ilike('buyer_email', buyerEmail)
    .in('status', ['active', 'trialing', 'pending_confirmation'])
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      error: 'Ya tienes una suscripción activa o pendiente para este anuncio.',
      existingId: existing.id,
    }, { status: 409 })
  }

  // ── Get optional Clerk user ───────────────────────────────────────────────
  const clerkUser = await currentUser()

  // ── Get subscription interval from listing metadata ───────────────────────
  const listingMeta = (listing.metadata ?? {}) as Record<string, unknown>
  const subMeta = (listingMeta.subscription ?? {}) as Record<string, unknown>
  const interval = (subMeta.interval as string) ?? 'month'

  // ── Create pending_confirmation subscription ──────────────────────────────
  const periodStart = new Date()
  const periodEnd = new Date(periodStart)
  if (interval === 'year') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1)
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1)
  }

  const { data: sub, error: insertErr } = await db
    .from('marketplace_subscriptions')
    .insert({
      listing_id: listingId,
      shop_id: shop.id,
      buyer_clerk_user_id: clerkUser?.id ?? null,
      buyer_email: buyerEmail.toLowerCase().trim(),
      buyer_name: buyerName.trim(),
      payment_method: 'spei',
      status: 'pending_confirmation',
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .select('id')
    .single()

  if (insertErr || !sub) {
    console.error('[spei sub] insert error:', insertErr)
    return NextResponse.json({ error: 'Error al registrar la suscripción.' }, { status: 500 })
  }

  // ── Telegram to seller ────────────────────────────────────────────────────
  const amount = formatOfferAmount(listing.price_cents ?? 0, listing.currency ?? 'MXN')
  tg.alert(
    `💳 <b>Nueva suscripción SPEI pendiente</b>\n` +
    `Comprador: ${buyerName} (${buyerEmail})\n` +
    `Plan: ${listing.title} · ${amount}/${interval === 'year' ? 'año' : 'mes'}\n` +
    `Tienda: ${shop.name}\n` +
    `<b>Confirma en: miyagisanchez.com/shop/manage/subscriptions</b>`,
  )

  return NextResponse.json({
    subscriptionId: sub.id,
    status: 'pending_confirmation',
    clabe: clabe ?? null,
    bank_name: bankName ?? null,
    account_holder: accountHolder ?? null,
    message: clabe
      ? `Realiza tu transferencia SPEI a la CLABE ${clabe}${bankName ? ` (${bankName})` : ''}${accountHolder ? ` · Beneficiario: ${accountHolder}` : ''} y notifica al vendedor.`
      : 'El vendedor te enviará la CLABE por mensaje directo.',
  }, { status: 201 })
}
