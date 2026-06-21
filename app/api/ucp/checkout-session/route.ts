/**
 * POST /api/ucp/checkout-session
 *
 * The unified checkout intelligence endpoint. Given a listing (+ optional offer),
 * returns every payment method the seller has enabled with:
 *   - Pre-generated checkout URLs for instant methods (MP, Stripe)
 *   - Structured instructions for contact-first methods (SPEI, cash, WhatsApp)
 *   - A recommended_method field so an agent can present the best option first
 *   - Escrow details when applicable
 *
 * Payment methods covered:
 *   mercadopago    — cards, OXXO, digital wallet, meses sin intereses
 *   stripe         — international cards (Visa/MC/AMEX)
 *   bank_transfer  — SPEI with seller's CLABE, bank, and account holder
 *   cash_on_pickup — derived from shop's local_pickup setting
 *   whatsapp       — contact-first, derived from shop phone + whatsapp_cta
 *
 * Used by:
 *   - MCP tool: get_checkout_options (buyer's AI agent)
 *   - Any third-party integration or embed widget
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { toUcpListing } from '@/lib/ucp/schema'
import { readPersonalization, validatePersonalization, getCustomFields, type PersonalizationPayload } from '@/lib/personalization'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import { isEmbedRequest } from '@/lib/embed-auth'
import { isShopClaimed } from '@/lib/claim'
import { ensureUrlProtocol } from '@/lib/url'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import type { Listing, Shop } from '@/lib/types'
import { randomUUID } from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentMethodKey = 'mercadopago' | 'stripe' | 'bank_transfer' | 'cash_on_pickup' | 'whatsapp' | 'schedule'

interface PaymentOption {
  method:        PaymentMethodKey
  label:         string
  description:   string
  available:     boolean
  instant:       boolean        // true = payment completes now; false = seller confirms later
  escrow_compatible: boolean    // can this method be combined with Compra Protegida?
  // Instant methods
  checkout_url?: string
  // Contact-first methods
  instructions?: string
  contact_url?:  string         // wa.me link or tel: link
  bank_details?: {
    clabe:          string
    bank_name:      string | null
    account_holder: string | null
  }
  // Why unavailable (helps AI agent give useful feedback)
  reason_unavailable?: string
  // Scheduling (Cal.com)
  booking_url?: string
}

interface UcpCheckoutSession {
  session_id:          string
  created_at:          string
  expires_at:          string   // sessions are informational — 30 min expiry
  listing_id:          string
  offer_id:            string | null
  price: {
    amount_cents:      number
    currency:          string
    formatted:         string
    is_offer_price:    boolean
  } | null
  payment_options:     PaymentOption[]
  recommended_method:  PaymentMethodKey | null
  available_count:     number
  escrow: {
    available:         boolean
    required:          boolean
    mode:              'off' | 'optional' | 'required'
    description:       string
  }
  listing:             ReturnType<typeof toUcpListing>
  // Buyer personalization the agent submitted (echoed back) + whether all the
  // listing's required fields are satisfied — so the agent can self-correct
  // before placing the order.
  personalization: {
    submitted: PersonalizationPayload | null
    required_complete: boolean
    missing_field_id: string | null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatMxn(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(cents / 100)
}

function whatsappLink(phone: string, listingTitle: string): string {
  const digits = phone.replace(/\D/g, '')
  const full   = digits.startsWith('52') ? digits : `52${digits}`
  const text   = encodeURIComponent(`Hola, me interesa tu artículo "${listingTitle}". ¿Sigue disponible?`)
  return `https://wa.me/${full}?text=${text}`
}

function listingLookupColumn(listingId: string) {
  return listingId.startsWith('prod_') ? 'medusa_product_id' : 'id'
}

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/**
 * Authoritative payment-method availability from Medusa's checkout-options —
 * the SAME source the web checkout uses, so agents and humans see identical
 * options. Returns a set of UCP method keys, or null if the backend is
 * unreachable (caller falls back to local computation).
 */
async function fetchBackendPaymentMethods(
  sellerRef: string,
  listingType: string,
  isDigital: boolean,
): Promise<Set<PaymentMethodKey> | null> {
  try {
    const qs = new URLSearchParams({ listing_type: listingType, is_digital: String(isDigital) })
    const res = await fetch(
      `${MEDUSA_BASE}/store/sellers/${encodeURIComponent(sellerRef)}/checkout-options?${qs}`,
      { headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY } },
    )
    if (!res.ok) return null
    const data = await res.json() as {
      payment_methods?: Array<{ id: string; kind?: string; sub_options?: Array<{ type: string }> }>
    }
    const set = new Set<PaymentMethodKey>()
    for (const m of data.payment_methods ?? []) {
      if (m.id === 'mercadopago') set.add('mercadopago')
      else if (m.id === 'stripe') set.add('stripe')
      else if (m.id === 'manual') {
        // Manual now carries structured sub-options (clabe=SPEI, cash=on-pickup).
        for (const so of m.sub_options ?? []) {
          if (so.type === 'clabe') set.add('bank_transfer')
          else if (so.type === 'cash') set.add('cash_on_pickup')
        }
      }
    }
    return set
  } catch {
    return null
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Widget traffic is rate-limited; agents/marketplace are not. No-op w/o Redis.
  if (isEmbedRequest(req)) {
    const rl = await checkRateLimit('embed', getClientIp(req))
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes.' },
        { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
      )
    }
  }

  const host    = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto   = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  let body: { listing_id?: string; offer_id?: string; buyer_email?: string; buyer_name?: string; personalization?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS })
  }

  const { listing_id, offer_id, buyer_email, buyer_name } = body
  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400, headers: CORS })
  }

  // ── Fetch listing + shop ──────────────────────────────────────────────────
  const { data: rawListing, error: listErr } = await db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,clerk_user_id,metadata,mp_enabled,source_url)')
    .eq(listingLookupColumn(listing_id), listing_id)
    .eq('status', 'active')
    .single()

  if (listErr || !rawListing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404, headers: CORS })
  }

  const listing = rawListing as Listing
  const shop    = listing.shop as (Shop & { mp_enabled?: boolean | null }) | undefined
  const shopMeta = (shop?.metadata ?? {}) as Record<string, unknown>
  const settings = (shopMeta.settings ?? {}) as Record<string, unknown>
  const checkout = (settings.checkout ?? {}) as Record<string, unknown>
  const shipping = (settings.shipping ?? {}) as Record<string, unknown>

  // ── Resolve effective price (list vs accepted offer) ──────────────────────
  let priceCents = listing.price_cents
  let isOfferPrice = false

  if (offer_id) {
    const { data: offer } = await db
      .from('marketplace_offers')
      .select('offer_amount_cents, counter_amount_cents, status')
      .eq('id', offer_id)
      .eq('listing_id', listing.id)
      .single()

    if (offer?.status === 'accepted') {
      priceCents   = offer.counter_amount_cents ?? offer.offer_amount_cents
      isOfferPrice = true
    }
  }

  const currency   = listing.currency ?? 'MXN'
  const hasPrice   = priceCents != null && priceCents > 0
  const isDigital  = listing.listing_type === 'digital'
  const isClaimed  = isShopClaimed(shop)

  // ── Shop signals ──────────────────────────────────────────────────────────
  const stripeSettings = ((settings.stripe ?? {}) as Record<string, unknown>)
  const hasMp          = sellerHasMpConnected(shopMeta as Record<string, unknown> | null)
  const hasStripe      = !!(stripeSettings.enabled !== false && stripeSettings.charges_enabled && stripeSettings.account_id)

  const bankTransfer   = (checkout.bank_transfer ?? {}) as Record<string, unknown>
  const hasBankTransfer = !!(bankTransfer.enabled && bankTransfer.clabe)

  const localPickup    = !!(shipping.local_pickup)
  const theme = (settings.theme ?? {}) as Record<string, unknown>
  const social = (theme.social ?? {}) as Record<string, unknown>
  const shopPhone = checkout.show_phone ? ((checkout.phone as string | null | undefined) ?? null) : null
  const whatsappPhone = ((social.whatsapp as string | null | undefined) ?? (checkout.phone as string | null | undefined) ?? null)
  const hasWhatsapp    = !!(checkout.whatsapp_cta && whatsappPhone)
  const hasPickupContact = localPickup && (!!shopPhone || !!(checkout.whatsapp_cta && whatsappPhone))

  // Scheduling links (link-drop tier — no API key required)
  const schedulingMeta = (settings.scheduling ?? {}) as { links?: Array<{ label: string; url: string }> }
  const schedulingLinks = schedulingMeta.links ?? []

  // ── Escrow ────────────────────────────────────────────────────────────────
  const escrowMode = (checkout.escrow_mode as 'off' | 'optional' | 'required' | undefined) ?? 'off'

  // ── Authoritative payment availability (Medusa checkout-options) ───────────
  // Single source of truth shared with the web checkout. Falls back to the
  // local signals above when the backend is unreachable. The seller slug
  // resolves the Medusa seller; id is a fallback.
  const beMethods = await fetchBackendPaymentMethods(
    shop?.slug ?? shop?.id ?? '',
    listing.listing_type ?? 'product',
    isDigital,
  )
  const beHas = (k: PaymentMethodKey) => (beMethods ? beMethods.has(k) : null)
  // available = backend says so (when reachable) else local; price/claim always required.
  const mpAvailable = (beHas('mercadopago') ?? (hasMp && !isDigital)) && hasPrice && isClaimed
  const stripeAvailable = (beHas('stripe') ?? hasStripe) && hasPrice && isClaimed
  const bankAvailable = (beHas('bank_transfer') ?? (hasBankTransfer && !isDigital)) && hasPrice
  const cashAvailable = (beHas('cash_on_pickup') ?? (localPickup && !isDigital)) && isClaimed

  // ── Build payment options ─────────────────────────────────────────────────

  // 1. MercadoPago
  let mpCheckoutUrl: string | undefined
  if (mpAvailable) {
    // Pre-generate MP preference lazily — we return the POST endpoint + params instead
    // (avoids burning an MP API call on every session request)
    mpCheckoutUrl = `${baseUrl}/api/mp/checkout`
  }

  const mpOption: PaymentOption = {
    method: 'mercadopago',
    label:  'Mercado Pago',
    description: 'Tarjeta de crédito/débito, OXXO, Mercado Pago wallet, meses sin intereses',
    available: mpAvailable,
    instant:   true,
    escrow_compatible: escrowMode !== 'off',
    checkout_url: mpCheckoutUrl,
    ...(!hasMp && { reason_unavailable: 'El vendedor no acepta Mercado Pago en este momento.' }),
    ...(!isClaimed && { reason_unavailable: 'Este anuncio aún no tiene vendedor registrado.' }),
    ...(isDigital && { reason_unavailable: 'Los productos digitales se pagan con tarjeta vía Stripe.' }),
    ...(!hasPrice && { reason_unavailable: 'Este anuncio no tiene precio definido.' }),
  }

  // 2. Stripe
  const stripeOption: PaymentOption = {
    method: 'stripe',
    label:  'Tarjeta internacional',
    description: 'Visa, Mastercard, American Express — pago directo al vendedor',
    available: stripeAvailable,
    instant:   true,
    escrow_compatible: escrowMode !== 'off',
    checkout_url: stripeAvailable ? `${baseUrl}/api/stripe/checkout` : undefined,
    ...(!hasStripe && { reason_unavailable: 'El vendedor no ha conectado Stripe.' }),
  }

  // 3. Bank transfer (SPEI)
  const bankOption: PaymentOption = {
    method: 'bank_transfer',
    label:  'Transferencia bancaria (SPEI)',
    description: 'Transfiere desde cualquier banco mexicano. El vendedor confirma antes de enviar.',
    available: bankAvailable,
    instant:   false,
    escrow_compatible: false,  // manual confirmation — can't hold in escrow
    ...(hasBankTransfer && {
      instructions: `Transfiere ${ hasPrice ? formatMxn(priceCents!, currency) : '' } a la cuenta indicada y envía tu comprobante al vendedor.`,
      bank_details: {
        clabe:          String(bankTransfer.clabe ?? ''),
        bank_name:      (bankTransfer.bank_name as string | null) ?? null,
        account_holder: (bankTransfer.account_holder as string | null) ?? null,
      },
    }),
    ...(!hasBankTransfer && { reason_unavailable: 'El vendedor no ha configurado transferencia bancaria.' }),
  }

  // 4. Cash on pickup
  const cashOption: PaymentOption = {
    method: 'cash_on_pickup',
    label:  'Efectivo al recoger',
    description: 'Paga en efectivo cuando vayas a recoger el artículo. Coordina con el vendedor.',
    available: cashAvailable,
    instant:   false,
    escrow_compatible: false,
    ...(hasPickupContact && {
      instructions: 'Contacta al vendedor para coordinar lugar y hora de entrega.',
      contact_url:  checkout.whatsapp_cta && whatsappPhone ? whatsappLink(whatsappPhone, listing.title) : `tel:${shopPhone}`,
    }),
    ...(localPickup && !shopPhone && {
      instructions: 'Escríbele al vendedor para coordinar la entrega.',
    }),
    ...(!localPickup && { reason_unavailable: 'El vendedor no ofrece entrega en mano.' }),
    ...(isDigital && { reason_unavailable: 'Producto digital — no requiere entrega en persona.' }),
  }

  // 5. WhatsApp / direct contact
  const waOption: PaymentOption = {
    method: 'whatsapp',
    label:  'Acordar por WhatsApp',
    description: 'Contacta al vendedor directamente para acordar forma de pago y entrega.',
    available: hasWhatsapp && !isDigital && isClaimed,
    instant:   false,
    escrow_compatible: false,
    ...(hasWhatsapp && whatsappPhone && {
      instructions: 'Escríbele al vendedor por WhatsApp para acordar el pago.',
      contact_url:  whatsappLink(whatsappPhone, listing.title),
    }),
    ...(!hasWhatsapp && { reason_unavailable: 'El vendedor no tiene WhatsApp configurado.' }),
  }

  // 6. Cal.com scheduling (API-connected) + link-drop fallback
  const calcomSettings = (settings.calcom ?? {}) as { connected?: boolean; booking_url?: string; event_type_title?: string }
  const hasCalcom = !!(calcomSettings.connected && calcomSettings.booking_url)
  const hasSchedulingLinks = schedulingLinks.length > 0
  const hasSchedule = hasCalcom || hasSchedulingLinks
  // Prefer API-connected booking URL; fall back to first manual link.
  // Normalize a scheme-less seller-typed link so agents get a fully-qualified URL.
  const scheduleBookingUrl = ensureUrlProtocol(calcomSettings.booking_url || schedulingLinks[0]?.url) ?? undefined
  const scheduleLabel = listing.category === 'autos' ? '🚗 Agendar prueba de manejo'
    : listing.category === 'inmuebles' ? '🏠 Agendar visita'
    : listing.listing_type === 'service' ? '🕐 Agendar cita'
    : '📅 Agendar'
  const scheduleDescription = hasCalcom
    ? (calcomSettings.event_type_title ?? 'Reserva una cita con el vendedor')
    : hasSchedulingLinks
    ? (schedulingLinks[0]?.label ?? 'Reserva una cita con el vendedor')
    : 'Reserva una cita con el vendedor'
  const scheduleOption: PaymentOption = {
    method:            'schedule',
    label:             scheduleLabel,
    description:       scheduleDescription,
    available:         hasSchedule,
    instant:           false,
    escrow_compatible: false,
    ...(hasSchedule && {
      booking_url: scheduleBookingUrl,
      instructions: hasCalcom
        ? 'Elige tu horario. Cal.com enviará una confirmación por correo a ambas partes.'
        : 'Haz clic en el enlace para ver los horarios disponibles y reservar.',
    }),
    ...(!hasSchedule && { reason_unavailable: 'El vendedor no tiene agendamiento habilitado.' }),
  }

  const allOptions = [mpOption, stripeOption, bankOption, cashOption, waOption, scheduleOption]
  const available  = allOptions.filter(o => o.available)

  // ── Recommend best method ─────────────────────────────────────────────────
  // Priority: instant escrow-compatible > instant > contact-first
  const recommended: PaymentMethodKey | null =
    available.find(o => o.instant && o.escrow_compatible)?.method ??
    available.find(o => o.instant)?.method ??
    available.find(o => o.available)?.method ??
    null

  // ── Personalization (agent-submitted) ──────────────────────────────────────
  // Validate the submitted payload against the listing's required custom fields
  // so the agent knows whether it's safe to place the order.
  const customFields = getCustomFields((listing.metadata ?? {}) as Record<string, unknown>)
  const submittedPersonalization = readPersonalization(body.personalization)
  const submittedValues = Object.fromEntries((submittedPersonalization?.fields ?? []).map(f => [f.id, f.value]))
  const personalizationCheck = validatePersonalization(customFields, submittedValues)

  // ── Compose session ────────────────────────────────────────────────────────
  const now       = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000)

  const session: UcpCheckoutSession = {
    session_id:         randomUUID(),
    created_at:         now.toISOString(),
    expires_at:         expiresAt.toISOString(),
    listing_id:         listing.id,
    offer_id:           offer_id ?? null,
    price: hasPrice ? {
      amount_cents:  priceCents!,
      currency,
      formatted:     formatMxn(priceCents!, currency),
      is_offer_price: isOfferPrice,
    } : null,
    payment_options:    allOptions,
    recommended_method: recommended,
    available_count:    available.length,
    escrow: {
      available:    escrowMode === 'optional' || escrowMode === 'required',
      required:     escrowMode === 'required',
      mode:         escrowMode,
      description:  escrowMode === 'required'
        ? 'Compra Protegida obligatoria — el pago queda retenido hasta que confirmes la recepción.'
        : escrowMode === 'optional'
        ? 'Compra Protegida disponible — puedes activarla para mayor seguridad.'
        : 'Sin Compra Protegida en esta tienda.',
    },
    listing: toUcpListing(listing, baseUrl),
    personalization: {
      submitted: submittedPersonalization,
      required_complete: customFields.length === 0 ? true : personalizationCheck.ok,
      missing_field_id: personalizationCheck.missingFieldId ?? null,
    },
  }

  return NextResponse.json(session, { headers: CORS })
}
