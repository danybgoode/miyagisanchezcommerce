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
    address.state?.trim() &&
    address.postal_code?.trim()
  )
}

function deliveryLabel(days: number | null) {
  if (!days || days <= 0) return null
  return days === 1 ? '1 dia habil' : `${days} dias habiles`
}

function buildPackage(listing: Listing, defaults: ShippingSettings['package_defaults']): EnviaPackage {
  // Per-product weight_grams is stored in metadata (Section 1). Fall back to shop defaults.
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

  // All must be shippable products
  const nonShippable = listings.filter(l => l.listing_type !== 'product')
  if (nonShippable.length === listings.length) {
    return NextResponse.json({ error: 'Ningún artículo del paquete requiere envío por paquetería.' }, { status: 422 })
  }
  // Filter to only physical products (ignore digital/service items in mixed bundles)
  const shippableListings = listings.filter(l => l.listing_type === 'product')

  // ── Seller settings (use first listing's shop) ──────────────────────────────
  const shopMeta = (shippableListings[0].shop?.metadata ?? {}) as Record<string, unknown>
  const settings = (shopMeta.settings ?? {}) as Record<string, unknown>
  const shipping = (settings.shipping ?? {}) as ShippingSettings
  const originRaw = shipping.origin_address

  if (shipping.envia_enabled === false) {
    return NextResponse.json({ error: 'El vendedor no tiene envío a domicilio activo.' }, { status: 422 })
  }
  if (!originRaw?.street || !originRaw.city || !originRaw.state || !originRaw.postal_code) {
    return NextResponse.json({ error: 'El vendedor todavía no completó su dirección de origen.' }, { status: 422 })
  }

  const origin: EnviaAddress = {
    name: originRaw.name ?? shippableListings[0].shop?.name ?? 'Vendedor',
    street: originRaw.street,
    number: originRaw.number ?? undefined,
    district: originRaw.colonia ?? undefined,
    city: originRaw.city,
    state: originRaw.state,
    postalCode: originRaw.postal_code,
  }

  const destination: EnviaAddress = {
    name: body.address.name ?? 'Comprador',
    phone: body.address.phone,
    street: body.address.line1 ?? '',
    district: body.address.line2,
    city: body.address.city ?? '',
    state: body.address.state ?? '',
    country: body.address.country ?? 'MX',
    postalCode: body.address.postal_code ?? '',
  }

  const packageDefaults = shipping.package_defaults ?? {}
  const carriers = shipping.allowed_carriers?.length ? shipping.allowed_carriers : DEFAULT_CARRIERS
  const handlingFeeCents = Math.max(0, Math.round(shipping.handling_fee_cents ?? 0))
  const rateDisplay = shipping.rate_display ?? 'recommended'

  // ── Build packages (one per shippable item) ──────────────────────────────────
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
    return NextResponse.json({ error: 'No pudimos cotizar envío para esa dirección. Revisa el CP o intenta otra opción.' }, { status: 502 })
  }
}
