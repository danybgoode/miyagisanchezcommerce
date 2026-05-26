import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { tg } from '@/lib/telegram'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

// Exchange a Clerk JWT for a Medusa store session token.
async function getMedusaToken(clerkJwt: string): Promise<string | null> {
  const res = await fetch(`${MEDUSA_BASE}/auth/store/clerk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PUB_KEY },
    body: JSON.stringify({ token: clerkJwt }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.token ?? null
}

function medusaFetch(path: string, token: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  })
}

interface CreatePayload {
  createShop?: {
    name: string
    state: string
    city?: string
    description?: string
  }
  listing: {
    title: string
    description?: string
    price_cents?: number | null
    currency?: string
    condition?: string | null
    listing_type: string
    category: string
    state?: string
    municipio?: string
    location?: string
    images: Array<{ url: string; alt: string }>
    digital_file?: {
      path: string
      name: string
      size: number
      mime: string
      label: string
    } | null
    repuve?: { status: 'sin_reporte' | 'con_reporte'; folio?: string } | null
    subscription?: { interval: 'month' | 'year'; content_description?: string } | null
    subscription_tiers?: Array<{
      id: string; label: string; price_cents: number
      interval: 'month' | 'year'; features: string[]; is_highlighted: boolean
    }> | null
  }
}

export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'No autenticado. Inicia sesión para publicar.' }, { status: 401 })
  }

  let body: CreatePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // ── Validate ─────────────────────────────────────────────────────────────
  const titleClean = body.listing?.title?.trim() ?? ''
  if (titleClean.length < 5) return NextResponse.json({ error: 'El título debe tener al menos 5 caracteres.', field: 'title' }, { status: 422 })
  if (titleClean.length > 100) return NextResponse.json({ error: 'El título no puede superar los 100 caracteres.', field: 'title' }, { status: 422 })
  if (!body.listing.category) return NextResponse.json({ error: 'Selecciona una categoría.', field: 'category' }, { status: 422 })

  const isSubscription = body.listing.listing_type === 'subscription'
  const hasMultiTier = isSubscription && Array.isArray(body.listing.subscription_tiers) && (body.listing.subscription_tiers?.length ?? 0) > 0

  if (isSubscription && !hasMultiTier) {
    if (!body.listing.price_cents || body.listing.price_cents <= 0) {
      return NextResponse.json({ error: 'Las suscripciones deben tener un precio.', field: 'price' }, { status: 422 })
    }
    const interval = body.listing.subscription?.interval
    if (!interval || !['month', 'year'].includes(interval)) {
      return NextResponse.json({ error: 'Selecciona el período de facturación.', field: 'subscription_interval' }, { status: 422 })
    }
  }

  // ── Get Medusa auth token ─────────────────────────────────────────────────
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const medusaToken = await getMedusaToken(clerkJwt)
  if (!medusaToken) return NextResponse.json({ error: 'No se pudo autenticar con el servidor. Inténtalo de nuevo.' }, { status: 401 })

  // ── Ensure seller exists (create on first publish) ──────────────────────
  let shopSlug: string
  {
    // Try to get existing seller
    let sellerRes = await medusaFetch('/store/sellers/me', medusaToken)
    if (sellerRes.status === 404 && body.createShop) {
      // Create seller
      const shopName = body.createShop.name?.trim() ?? ''
      if (shopName.length < 2) return NextResponse.json({ error: 'El nombre de la tienda debe tener al menos 2 caracteres.', field: 'shopName' }, { status: 422 })

      const location = [body.createShop.city?.trim(), body.createShop.state?.trim()].filter(Boolean).join(', ') || null

      const createRes = await medusaFetch('/store/sellers/me', medusaToken, {
        method: 'POST',
        body: JSON.stringify({
          name: shopName,
          description: body.createShop.description?.trim() || null,
          location,
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok || !createData.seller) {
        console.error('[sell/create] seller creation failed:', createData)
        return NextResponse.json({ error: 'No se pudo crear la tienda. Inténtalo de nuevo.' }, { status: 500 })
      }
      shopSlug = createData.seller.slug
    } else if (sellerRes.ok) {
      const sellerData = await sellerRes.json()
      shopSlug = sellerData.seller.slug
    } else {
      return NextResponse.json({ error: 'No encontramos tu tienda. Asegúrate de haber completado el onboarding.', field: 'shop' }, { status: 422 })
    }
  }

  // ── Build product metadata ────────────────────────────────────────────────
  const effectivePriceCents = hasMultiTier
    ? Math.min(...(body.listing.subscription_tiers ?? []).map(t => t.price_cents))
    : (body.listing.price_cents ?? null)

  const metadata: Record<string, unknown> = {
    ...(body.listing.condition ? { condition: body.listing.condition } : {}),
    ...(body.listing.state ? { state: body.listing.state } : {}),
    ...(body.listing.municipio ? { municipio: body.listing.municipio } : {}),
    ...(body.listing.digital_file ? { digital_file: body.listing.digital_file } : {}),
    ...(body.listing.repuve?.status ? { repuve: { status: body.listing.repuve.status, folio: body.listing.repuve.folio?.trim().toUpperCase() || null, verified_at: new Date().toISOString() } } : {}),
    ...(isSubscription && !hasMultiTier ? { subscription: { interval: body.listing.subscription!.interval, content_description: body.listing.subscription?.content_description?.trim() || null } } : {}),
    ...(isSubscription && hasMultiTier ? { subscription_tiers: (body.listing.subscription_tiers ?? []).map(t => ({ ...t, label: t.label.trim(), features: t.features.filter(Boolean) })) } : {}),
  }

  // ── Create product in Medusa ──────────────────────────────────────────────
  const productRes = await medusaFetch('/store/sellers/me/products', medusaToken, {
    method: 'POST',
    body: JSON.stringify({
      title: titleClean,
      description: body.listing.description?.trim() || null,
      price_cents: effectivePriceCents,
      currency: body.listing.currency ?? 'MXN',
      condition: body.listing.listing_type === 'product' ? (body.listing.condition ?? null) : null,
      listing_type: body.listing.listing_type ?? 'physical',
      category: body.listing.category,
      state: body.listing.state || null,
      municipio: body.listing.municipio || null,
      location: [body.listing.municipio?.trim(), body.listing.state?.trim()].filter(Boolean).join(', ') || null,
      images: body.listing.images ?? [],
      metadata,
    }),
  })

  const productData = await productRes.json()
  if (!productRes.ok || !productData.product_id) {
    console.error('[sell/create] product creation failed:', productData)
    return NextResponse.json({ error: 'Error al publicar el anuncio. Inténtalo de nuevo.' }, { status: 500 })
  }

  const listingId = productData.product_id

  // ── Telegram notification ────────────────────────────────────────────────
  const priceCents = body.listing.price_cents
  const currency = body.listing.currency ?? 'MXN'
  const priceFmt = priceCents
    ? new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(priceCents / 100)
    : 'Precio a consultar'
  tg.newListing(titleClean, priceFmt, shopSlug, listingId)

  return NextResponse.json({ shopSlug, listingId }, { status: 201 })
}
