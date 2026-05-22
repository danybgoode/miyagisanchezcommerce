import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'
import { createSubscriptionPrice } from '@/lib/stripe-subscriptions'
import { getShopStripe } from '@/lib/stripe'

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
    // Subscription-specific fields — Phase A (single tier, backward compat)
    subscription?: {
      interval: 'month' | 'year'
      content_description?: string
    } | null
    // Phase B: multi-tier (1–3 plans per listing)
    subscription_tiers?: Array<{
      id: string
      label: string
      price_cents: number
      interval: 'month' | 'year'
      features: string[]
      is_highlighted: boolean
    }> | null
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

  // ── Subscription validation ──────────────────────────────────────────────
  const isSubscription = body.listing.listing_type === 'subscription'
  const hasMultiTier   = isSubscription && Array.isArray(body.listing.subscription_tiers) && body.listing.subscription_tiers!.length > 0
  if (isSubscription) {
    if (hasMultiTier) {
      const tiers = body.listing.subscription_tiers!
      if (tiers.length > 3) {
        return NextResponse.json({ error: 'Máximo 3 planes por suscripción.', field: 'subscription_tiers' }, { status: 422 })
      }
      for (const t of tiers) {
        if (!t.price_cents || t.price_cents <= 0) {
          return NextResponse.json({ error: `El plan "${t.label}" necesita un precio válido.`, field: 'subscription_tiers' }, { status: 422 })
        }
        if (!['month', 'year'].includes(t.interval)) {
          return NextResponse.json({ error: `Intervalo inválido en el plan "${t.label}".`, field: 'subscription_tiers' }, { status: 422 })
        }
      }
    } else {
      if (!body.listing.price_cents || body.listing.price_cents <= 0) {
        return NextResponse.json({ error: 'Las suscripciones deben tener un precio.', field: 'price' }, { status: 422 })
      }
      const interval = body.listing.subscription?.interval
      if (!interval || !['month', 'year'].includes(interval)) {
        return NextResponse.json({ error: 'Selecciona el período de facturación.', field: 'subscription_interval' }, { status: 422 })
      }
    }
  }

  // ── Create listing ───────────────────────────────────────────────────────
  const locationDisplay = [body.listing.municipio?.trim(), body.listing.state?.trim()]
    .filter(Boolean).join(', ') || null

  // For multi-tier subscriptions, price_cents = lowest tier price (for browse display)
  const effectivePriceCents = hasMultiTier
    ? Math.min(...body.listing.subscription_tiers!.map(t => t.price_cents))
    : (body.listing.price_cents ?? null)

  const { data: listing, error: listingErr } = await db
    .from('marketplace_listings')
    .insert({
      shop_id: shopId,
      title: titleClean.slice(0, 100),
      description: body.listing.description?.trim() || null,
      price_cents: effectivePriceCents,
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
        ...(isSubscription && !hasMultiTier ? {
          subscription: {
            interval: body.listing.subscription!.interval,
            content_description: body.listing.subscription?.content_description?.trim() || null,
          }
        } : {}),
        ...(isSubscription && hasMultiTier ? {
          subscription_tiers: body.listing.subscription_tiers!.map(t => ({
            id: t.id,
            label: t.label.trim(),
            price_cents: t.price_cents,
            interval: t.interval,
            features: t.features.filter(Boolean),
            is_highlighted: t.is_highlighted,
          })),
        } : {}),
      },
    })
    .select('id')
    .single()

  if (listingErr || !listing) {
    console.error('Listing creation error:', listingErr)
    return NextResponse.json({ error: 'Error al publicar el anuncio. Inténtalo de nuevo.' }, { status: 500 })
  }

  // ── If subscription: create Stripe Product(s) + Price(s) ────────────────
  if (isSubscription) {
    try {
      const { data: shopForStripe } = await db
        .from('marketplace_shops')
        .select('metadata')
        .eq('id', shopId)
        .maybeSingle()

      const stripeSettings = getShopStripe(shopForStripe?.metadata as Record<string, unknown> | null)
      const currency = body.listing.currency ?? 'MXN'
      const description = body.listing.description?.trim() || null

      if (hasMultiTier) {
        // Create one Stripe Price per tier, patch back into subscription_tiers
        const tiersWithStripe = await Promise.all(
          body.listing.subscription_tiers!.map(async t => {
            const { productId, priceId } = await createSubscriptionPrice({
              listingId: listing.id,
              shopId,
              title: `${titleClean} — ${t.label}`,
              description,
              price_cents: t.price_cents,
              currency,
              interval: t.interval,
            })
            return { ...t, stripe_product_id: productId, stripe_price_id: priceId }
          }),
        )
        await db.from('marketplace_listings').update({
          metadata: {
            subscription_tiers: tiersWithStripe,
            stripe_account_id: stripeSettings.account_id ?? null,
          },
        }).eq('id', listing.id)
      } else if (body.listing.price_cents && body.listing.price_cents > 0) {
        // Single-tier (Phase A compat)
        const { productId, priceId } = await createSubscriptionPrice({
          listingId: listing.id,
          shopId,
          title: titleClean,
          description,
          price_cents: body.listing.price_cents,
          currency,
          interval: (body.listing.subscription?.interval ?? 'month') as 'month' | 'year',
        })
        await db.from('marketplace_listings').update({
          metadata: {
            subscription: {
              interval: body.listing.subscription!.interval,
              content_description: body.listing.subscription?.content_description?.trim() || null,
              stripe_product_id: productId,
              stripe_price_id: priceId,
              stripe_account_id: stripeSettings.account_id ?? null,
            },
          },
        }).eq('id', listing.id)
      }
    } catch (e) {
      // Non-fatal: listing is published, Stripe IDs can be set up later
      console.error('[create] Stripe subscription price creation failed:', e)
    }
  }

  // ── Telegram admin notification ──────────────────────────────────────────
  const priceCents = body.listing.price_cents
  const currency   = body.listing.currency ?? 'MXN'
  const priceFmt   = priceCents
    ? new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(priceCents / 100)
    : 'Precio a consultar'
  tg.newListing(titleClean, priceFmt, shopSlug, listing.id)

  return NextResponse.json({ shopSlug, listingId: listing.id }, { status: 201 })
}
