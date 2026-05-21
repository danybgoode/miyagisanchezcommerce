import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${base}-${Math.random().toString(36).slice(2, 6)}`
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
    repuve?: {
      status: 'sin_reporte' | 'con_reporte'
      folio?: string
    } | null
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'No autenticado. Inicia sesión para publicar.' }, { status: 401 })
  }

  let body: CreatePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // ── Validate listing fields ──────────────────────────────────────────────
  const titleClean = body.listing?.title?.trim() ?? ''
  if (titleClean.length < 5) {
    return NextResponse.json({ error: 'El título debe tener al menos 5 caracteres.', field: 'title' }, { status: 422 })
  }
  if (titleClean.length > 100) {
    return NextResponse.json({ error: 'El título no puede superar los 100 caracteres.', field: 'title' }, { status: 422 })
  }
  if (!body.listing.category) {
    return NextResponse.json({ error: 'Selecciona una categoría.', field: 'category' }, { status: 422 })
  }
  if (body.listing.price_cents !== null && body.listing.price_cents !== undefined) {
    if (body.listing.price_cents < 0) {
      return NextResponse.json({ error: 'El precio no puede ser negativo.', field: 'price' }, { status: 422 })
    }
  }

  // ── Resolve shop ─────────────────────────────────────────────────────────
  let shopId = ''
  let shopSlug = ''

  if (body.createShop) {
    const shopNameClean = body.createShop.name?.trim() ?? ''
    if (shopNameClean.length < 2) {
      return NextResponse.json({ error: 'El nombre de la tienda debe tener al menos 2 caracteres.', field: 'shopName' }, { status: 422 })
    }
    if (shopNameClean.length > 80) {
      return NextResponse.json({ error: 'El nombre de la tienda no puede superar los 80 caracteres.', field: 'shopName' }, { status: 422 })
    }

    const location = [body.createShop.city?.trim(), body.createShop.state?.trim()]
      .filter(Boolean).join(', ') || null

    // Retry up to 3 times on slug collision
    let created = false
    let lastError: string | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      const slug = generateSlug(shopNameClean)
      const { data: shop, error } = await db
        .from('marketplace_shops')
        .insert({
          slug,
          name: shopNameClean,
          description: body.createShop.description?.trim() || null,
          location,
          clerk_user_id: userId,
          source: 'seller',
          verified: false,
          metadata: { settings: {} },
        })
        .select('id, slug')
        .single()

      if (shop) {
        shopId = shop.id
        shopSlug = shop.slug
        created = true
        break
      }
      lastError = error?.message
      // Only retry on unique constraint violations
      if (error && !error.message.includes('unique') && !error.message.includes('duplicate')) break
    }

    if (!created) {
      console.error('Failed to create shop:', lastError)
      return NextResponse.json({ error: 'No se pudo crear la tienda. Inténtalo de nuevo.' }, { status: 500 })
    }
  } else {
    // Find the seller's existing shop
    const { data: shop, error } = await db
      .from('marketplace_shops')
      .select('id, slug')
      .eq('clerk_user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Shop lookup error:', error)
      return NextResponse.json({ error: 'Error al buscar tu tienda.' }, { status: 500 })
    }
    if (!shop) {
      return NextResponse.json({ error: 'No encontramos tu tienda. Recarga la página.', field: 'shop' }, { status: 422 })
    }
    shopId = shop.id
    shopSlug = shop.slug
  }

  // ── Create listing ───────────────────────────────────────────────────────
  const locationDisplay = [body.listing.municipio?.trim(), body.listing.state?.trim()]
    .filter(Boolean).join(', ') || null

  const { data: listing, error: listingErr } = await db
    .from('marketplace_listings')
    .insert({
      shop_id: shopId,
      title: titleClean.slice(0, 100),
      description: body.listing.description?.trim() || null,
      price_cents: body.listing.price_cents ?? null,
      currency: body.listing.currency ?? 'MXN',
      condition: body.listing.listing_type === 'product' ? (body.listing.condition ?? null) : null,
      listing_type: body.listing.listing_type ?? 'product',
      category: body.listing.category,
      state: body.listing.state || null,
      municipio: body.listing.municipio || null,
      location: locationDisplay,
      images: body.listing.images ?? [],
      status: 'active',
      source: 'seller',
      source_platform: null,
      metadata: {
        ...(body.listing.digital_file ? { digital_file: body.listing.digital_file } : {}),
        ...(body.listing.repuve?.status ? {
          repuve: {
            status:      body.listing.repuve.status,
            folio:       body.listing.repuve.folio?.trim().toUpperCase() || null,
            verified_at: new Date().toISOString(),
          }
        } : {}),
      },
    })
    .select('id')
    .single()

  if (listingErr || !listing) {
    console.error('Listing creation error:', listingErr)
    return NextResponse.json({ error: 'Error al publicar el anuncio. Inténtalo de nuevo.' }, { status: 500 })
  }

  return NextResponse.json({ shopSlug, listingId: listing.id }, { status: 201 })
}
