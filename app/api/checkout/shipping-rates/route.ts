/**
 * POST /api/checkout/shipping-rates
 *
 * Quote live Envia.com shipping rates.
 *
 * Single-item:  { listingId, address }
 * Bundle:       { items: string[], address }  ← all items must belong to one seller
 *
 * Returns { rates[] } using the seller's ShippingSettings (carriers, handling fee, display).
 * Bundle path combines all item weights/dims into one shipment (charged once).
 */
import { NextRequest, NextResponse } from 'next/server'
import { quoteShipments, type EnviaAddress, type EnviaPackage } from '@/lib/envia'
import { toEnviaStateCode } from '@/lib/mx-locations'
import type { Listing } from '@/lib/types'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const DEFAULT_CARRIERS = ['dhl', 'fedex', 'estafeta', 'ups', 'redpack', 'paquetexpress']

type CheckoutAddress = {
  name?: string
  phone?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  /** Resolved Envia 2-digit state code (populated by CP-first lookup) */
  state_code?: string
  postal_code?: string
  country?: string
}

type ShippingSettings = {
  envia_enabled?: boolean
  allowed_carriers?: string[]
  rate_display?: 'recommended' | 'cheapest' | 'all'
  handling_fee_cents?: number
  package_defaults?: {
    weight_grams?: number
    length_cm?: number
    width_cm?: number
    height_cm?: number
  }
  origin_address?: {
    name?: string | null
    street?: string | null
    number?: string | null
    colonia?: string | null
    city?: string | null
    state?: string | null
    state_code?: string | null
    postal_code?: string | null
  }
}

async function getListing(listingId: string): Promise<Listing | null> {
  const res = await fetch(`${MEDUSA_BASE}/store/listings/${listingId}`, {
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const data = await res.json() as { listing?: Listing | null }
  return data.listing ?? null
}

function requiredAddressReady(address: CheckoutAddress) {
  return Boolean(
    address.name?.trim() &&
    address.line1?.trim() &&
    address.city?.trim() &&
    (address.state_code?.trim() || address.state?.trim()) &&
    address.postal_code?.trim()
  )
}

function deliveryLabel(days: number | null) {
  if (!days || days <= 0) return null
  return days === 1 ? '1 dia habil' : `${days} dias habiles`
}

function buildPackage(listing: Listing, defaults: ShippingSettings['package_defaults']): EnviaPackage {
  const productMeta = (listing.metadata ?? {}) as Record<string, unknown>
  const weightGrams = (productMeta.weight_grams as number | undefined) ?? defaults?.weight_grams ?? 500
  return {
    content: listing.title.slice(0, 80),
    weight: Math.max(0.1, weightGrams / 1000),
    declaredValue: listing.price_cents ? Math.round(listing.price_cents / 100) : 0,
    dimensions: {
      length: Math.max(1, defaults?.length_cm ?? 20),
      width:  Math.max(1, defaults?.width_cm  ?? 15),
      height: Math.max(1, defaults?.height_cm ?? 10),
    },
  }
}

function mapEnviaError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('401') || m.includes('403') || m.includes('unauthorized') || m.includes('forbidden')) {
    return 'Error de configuración del envío. Contacta al vendedor.'
  }
  if (m.includes('postal') || m.includes('zip') || m.includes('zipcode') || m.includes('codigo postal')) {
    return 'El código postal ingresado no es válido. Revísalo e intenta de nuevo.'
  }
  if (m.includes('origin') || m.includes('origen')) {
    return 'La dirección de origen del vendedor no está completa. Contacta al vendedor.'
  }
  if (m.includes('coverage') || m.includes('cobertura') || m.includes('no service') || m.includes('no rates')) {
    return 'Las paqueterías no tienen cobertura para ese código postal. Intenta con otra dirección o coordina la entrega con el vendedor.'
  }
  if (m.includes('timeout') || m.includes('network') || m.includes('econnrefused')) {
    return 'No se pudo conectar con el servicio de paquetería. Intenta en unos momentos.'
  }
  return 'No pudimos cotizar envío. Verifica el código postal o coordina la entrega directamente con el vendedor.'
}

export async function POST(req: NextRequest) {
  let body: { listingId?: string; items?: string[]; address?: CheckoutAddress }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.address || !requiredAddressReady(body.address)) {
    return NextResponse.json({ error: 'Completa la dirección de entrega.' }, { status: 422 })
  }

  // ── Resolve listing(s) ───────────────────────────────────────────────────────
  const listingIds: string[] = body.items?.length
    ? body.items
    : body.listingId
      ? [body.listingId]
      : []

  if (listingIds.length === 0) {
    return NextResponse.json({ error: 'listingId o items requerido.' }, { status: 400 })
  }

  const listings = (await Promise.all(listingIds.map(id => getListing(id)))).filter(Boolean) as Listing[]
  if (listings.length === 0) {
    return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  }

  const nonShippable = listings.filter(l => l.listing_type !== 'product')
  if (nonShippable.length === listings.length) {
    return NextResponse.json({ error: 'Ningún artículo del paquete requiere envío por paquetería.' }, { status: 422 })
  }
  const shippableListings = listings.filter(l => l.listing_type === 'product')

  // ── Seller settings (use first listing's shop) ──────────────────────────────
  const shopMeta = (shippableListings[0].shop?.metadata ?? {}) as Record<string, unknown>
  const settings = (shopMeta.settings ?? {}) as Record<string, unknown>
  const shipping = (settings.shipping ?? {}) as ShippingSettings
  const originRaw = shipping.origin_address

  if (shipping.envia_enabled === false) {
    return NextResponse.json({ error: 'El vendedor no tiene envío a domicilio activo.' }, { status: 422 })
  }
  if (!originRaw?.street || !originRaw.city || !originRaw.postal_code) {
    return NextResponse.json({ error: 'El vendedor todavía no completó su dirección de origen. Coordina la entrega directamente.' }, { status: 422 })
  }
  if (!originRaw?.state && !originRaw?.state_code) {
    return NextResponse.json({ error: 'El vendedor todavía no completó su dirección de origen. Coordina la entrega directamente.' }, { status: 422 })
  }

  // Normalize origin state to Envia 2-digit code
  const originStateCode = toEnviaStateCode(originRaw.state_code ?? originRaw.state ?? '')

  const origin: EnviaAddress = {
    name: originRaw.name ?? shippableListings[0].shop?.name ?? 'Vendedor',
    street: originRaw.street,
    number: originRaw.number ?? undefined,
    district: originRaw.colonia ?? undefined,
    city: originRaw.city,
    state: originStateCode,
    country: 'MX',
    postalCode: originRaw.postal_code,
  }

  // Normalize destination state — prefer explicit state_code from CP lookup
  const destStateCode = body.address.state_code
    ? body.address.state_code
    : toEnviaStateCode(body.address.state ?? '')

  const destination: EnviaAddress = {
    name: body.address.name ?? 'Comprador',
    phone: body.address.phone,
    street: body.address.line1 ?? '',
    district: body.address.line2,
    city: body.address.city ?? '',
    state: destStateCode,
    country: 'MX',
    postalCode: body.address.postal_code ?? '',
  }

  const packageDefaults = shipping.package_defaults ?? {}
  const carriers = shipping.allowed_carriers?.length ? shipping.allowed_carriers : DEFAULT_CARRIERS
  const handlingFeeCents = Math.max(0, Math.round(shipping.handling_fee_cents ?? 0))
  const rateDisplay = shipping.rate_display ?? 'recommended'

  const packages: EnviaPackage[] = shippableListings.map(l => buildPackage(l, packageDefaults))

  try {
    const rates = await quoteShipments({ origin, destination, carriers, packages })

    const normalized = rates
      .filter(rate => rate.rateId && rate.carrier && rate.service && rate.totalPrice > 0)
      .map(rate => {
        const baseAmountCents = Math.round(rate.totalPrice * 100)
        const amountCents = baseAmountCents + handlingFeeCents
        return {
          id: `${rate.carrier}:${rate.service}:${rate.rateId}`,
          rateId: rate.rateId,
          carrier: rate.carrier,
          service: rate.service,
          baseAmountCents,
          handlingFeeCents,
          amountCents,
          currency: rate.currency || 'MXN',
          deliveryEstimate: rate.deliveryEstimate,
          deliveryLabel: deliveryLabel(rate.deliveryEstimate),
          logoUrl: rate.logoUrl ?? null,
        }
      })
      .sort((a, b) => {
        if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents
        return (a.deliveryEstimate ?? 99) - (b.deliveryEstimate ?? 99)
      })

    if (normalized.length === 0) {
      return NextResponse.json({
        rates: [],
        package_count: packages.length,
        message: 'Las paqueterías no tienen cobertura para ese destino. Puedes coordinar la entrega directamente con el vendedor.',
      })
    }

    const visibleRates = rateDisplay === 'cheapest'
      ? normalized.slice(0, 1)
      : rateDisplay === 'all'
        ? normalized.slice(0, 8)
        : normalized.slice(0, 3)

    return NextResponse.json({
      rates: visibleRates,
      package_count: packages.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[checkout/shipping-rates] Envia quote failed:', msg)
    return NextResponse.json(
      { error: mapEnviaError(msg) },
      { status: 502 },
    )
  }
}
