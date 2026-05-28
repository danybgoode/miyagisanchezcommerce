import { NextRequest, NextResponse } from 'next/server'
import { quoteShipments, type EnviaAddress } from '@/lib/envia'
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
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
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

export async function POST(req: NextRequest) {
  let body: { listingId?: string; address?: CheckoutAddress }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.listingId) return NextResponse.json({ error: 'listingId requerido.' }, { status: 400 })
  if (!body.address || !requiredAddressReady(body.address)) {
    return NextResponse.json({ error: 'Completa la dirección de entrega.' }, { status: 422 })
  }

  const listing = await getListing(body.listingId)
  if (!listing) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (listing.listing_type !== 'product') {
    return NextResponse.json({ error: 'Este anuncio no requiere envío por paquetería.' }, { status: 422 })
  }

  const shopMeta = (listing.shop?.metadata ?? {}) as Record<string, unknown>
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
    name: originRaw.name ?? listing.shop?.name ?? 'Vendedor',
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

  try {
    const rates = await quoteShipments({
      origin,
      destination,
      carriers,
      packages: [{
        content: listing.title.slice(0, 80),
        weight: Math.max(0.1, (packageDefaults.weight_grams ?? 500) / 1000),
        declaredValue: listing.price_cents ? Math.round(listing.price_cents / 100) : 0,
        dimensions: {
          length: Math.max(1, packageDefaults.length_cm ?? 20),
          width: Math.max(1, packageDefaults.width_cm ?? 15),
          height: Math.max(1, packageDefaults.height_cm ?? 10),
        },
      }],
    })

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

    return NextResponse.json({ rates: visibleRates })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[checkout/shipping-rates] Envia quote failed:', msg)
    return NextResponse.json({ error: 'No pudimos cotizar envío para esa dirección. Revisa el CP o intenta otra opción.' }, { status: 502 })
  }
}
