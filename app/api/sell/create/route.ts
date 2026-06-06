import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { tg } from '@/lib/telegram'
import { createSubscriptionPrice } from '@/lib/stripe-subscriptions'
import { ensureSupabaseShopMirror, syncSupabaseListingMirror, type MedusaSellerForMirror } from '@/lib/provisioning'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

interface CreatePayload {
  createShop?: {
    name: string
    slug?: string
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
    quantity?: number | null
    weight_grams?: number | null
    attrs?: Record<string, unknown>
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

  // ── Auth — pass Clerk JWT directly (backend uses extractClerkUserId) ──────
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  // ── Ensure seller exists (create on first publish) ──────────────────────
  let shopSlug: string
  let sellerId: string | null = null
  let sellerName: string | null = null
  let sellerForMirror: MedusaSellerForMirror | null = null
  {
    const sellerRes = await medusaFetch('/store/sellers/me', clerkJwt)

    if (sellerRes.ok) {
      // Seller already exists — use it
      const sellerData = await sellerRes.json()
      sellerForMirror = sellerData.seller
      shopSlug = sellerForMirror!.slug
      sellerId = sellerForMirror!.id ?? null
      sellerName = sellerForMirror!.name ?? null
    } else if (sellerRes.status === 404) {
      // No Medusa seller yet — create one.
      // Use explicit shop name from form (new users) or fall back to Clerk name
      // (legacy Supabase users who skipped the shop creation step).
      let shopName = body.createShop?.name?.trim() ?? ''
      if (!shopName) {
        const clerkUser = await currentUser()
        shopName = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ')
          || clerkUser?.emailAddresses[0]?.emailAddress?.split('@')[0]
          || 'Mi tienda'
      }
      if (shopName.length < 2) {
        return NextResponse.json({ error: 'El nombre de la tienda debe tener al menos 2 caracteres.', field: 'shopName' }, { status: 422 })
      }

      const location = body.createShop
        ? [body.createShop.city?.trim(), body.createShop.state?.trim()].filter(Boolean).join(', ') || null
        : null

      const createRes = await medusaFetch('/store/sellers/me', clerkJwt, {
        method: 'POST',
        body: JSON.stringify({
          name: shopName,
          ...(body.createShop?.slug?.trim() && { slug: body.createShop.slug.trim() }),
          description: body.createShop?.description?.trim() || null,
          location,
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok || !createData.seller) {
        console.error('[sell/create] seller creation failed:', createRes.status, createData)
        return NextResponse.json({ error: 'No se pudo crear la tienda. Inténtalo de nuevo.' }, { status: 500 })
      }
      sellerForMirror = createData.seller
      shopSlug = sellerForMirror!.slug
      sellerId = sellerForMirror!.id ?? null
      sellerName = sellerForMirror!.name ?? null
    } else {
      // Unexpected error from backend — surface it for easier debugging
      const errBody = await sellerRes.json().catch(() => ({})) as { message?: string }
      console.error('[sell/create] sellers/me failed:', sellerRes.status, errBody)
      return NextResponse.json({
        error: errBody.message ?? `Error ${sellerRes.status} al verificar tu tienda. Inténtalo de nuevo.`,
      }, { status: 500 })
    }
  }

  // ── Build product metadata ────────────────────────────────────────────────
  const effectivePriceCents = hasMultiTier
    ? Math.min(...(body.listing.subscription_tiers ?? []).map(t => t.price_cents))
    : (body.listing.price_cents ?? null)

  // For subscription tiers: create Stripe Prices now so we have stripe_price_id in metadata
  type TierWithStripe = {
    id: string; label: string; price_cents: number
    interval: 'month' | 'year'; features: string[]; is_highlighted: boolean
    stripe_price_id?: string
  }
  let tiersWithPriceIds: TierWithStripe[] = []
  if (isSubscription && hasMultiTier && sellerId) {
    tiersWithPriceIds = await Promise.all(
      (body.listing.subscription_tiers ?? []).map(async (t) => {
        try {
          const { priceId } = await createSubscriptionPrice({
            listingId: 'pending', // Will be backfilled after product creation
            shopId: sellerId!,
            title: `${body.listing.title?.trim()} — ${t.label.trim()}`,
            description: null,
            price_cents: t.price_cents,
            currency: body.listing.currency?.toLowerCase() ?? 'mxn',
            interval: t.interval,
          })
          return { ...t, label: t.label.trim(), features: t.features.filter(Boolean), stripe_price_id: priceId }
        } catch (e) {
          console.error('[sell/create] Stripe price creation failed for tier:', t.label, e)
          return { ...t, label: t.label.trim(), features: t.features.filter(Boolean) }
        }
      })
    )
  }

  // Single-tier subscription: create one Stripe Price
  let singleTierStripePriceId: string | null = null
  if (isSubscription && !hasMultiTier && body.listing.price_cents && sellerId) {
    try {
      const { priceId } = await createSubscriptionPrice({
        listingId: 'pending',
        shopId: sellerId,
        title: body.listing.title?.trim() ?? 'Suscripción',
        description: null,
        price_cents: body.listing.price_cents,
        currency: body.listing.currency?.toLowerCase() ?? 'mxn',
        interval: body.listing.subscription?.interval ?? 'month',
      })
      singleTierStripePriceId = priceId
    } catch (e) {
      console.error('[sell/create] Stripe price creation failed:', e)
    }
  }

  const metadata: Record<string, unknown> = {
    ...(body.listing.condition ? { condition: body.listing.condition } : {}),
    ...(body.listing.state ? { state: body.listing.state } : {}),
    ...(body.listing.municipio ? { municipio: body.listing.municipio } : {}),
    ...(body.listing.digital_file ? { digital_file: body.listing.digital_file } : {}),
    ...(body.listing.repuve?.status ? { repuve: { status: body.listing.repuve.status, folio: body.listing.repuve.folio?.trim().toUpperCase() || null, verified_at: new Date().toISOString() } } : {}),
    ...(isSubscription && !hasMultiTier ? {
      subscription: {
        interval: body.listing.subscription!.interval,
        content_description: body.listing.subscription?.content_description?.trim() || null,
        stripe_price_id: singleTierStripePriceId,
      }
    } : {}),
    ...(isSubscription && hasMultiTier ? { subscription_tiers: tiersWithPriceIds } : {}),
  }

  // ── Create product in Medusa ──────────────────────────────────────────────
  const productRes = await medusaFetch('/store/sellers/me/products', clerkJwt, {
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
      quantity: body.listing.listing_type === 'product' ? Math.max(1, Math.floor(body.listing.quantity ?? 1)) : 1,
      weight_grams: body.listing.weight_grams ?? null,
      attrs: body.listing.attrs ?? {},
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

  // ── Backwards-compatible Supabase mirror ────────────────────────────────
  // Medusa now owns sellers/products, but several seller-console features still
  // use Supabase UUID foreign keys. Keep a mirror row so /shop/manage/settings,
  // offers, subscriptions, and order records can find the newly provisioned shop.
  try {
    if (sellerForMirror) {
      const shopMirror = await ensureSupabaseShopMirror(sellerForMirror, userId)
      if (shopMirror?.id) {
        await syncSupabaseListingMirror(shopMirror.id, {
          id: listingId,
          title: titleClean,
          description: body.listing.description?.trim() || null,
          price_cents: effectivePriceCents,
          currency: body.listing.currency ?? 'MXN',
          condition: body.listing.listing_type === 'product' ? (body.listing.condition ?? null) : null,
          listing_type: body.listing.listing_type ?? 'product',
          category: body.listing.category,
          state: body.listing.state || null,
          municipio: body.listing.municipio || null,
          location: [body.listing.municipio?.trim(), body.listing.state?.trim()].filter(Boolean).join(', ') || null,
          images: body.listing.images ?? [],
          status: 'active',
          metadata,
        })
      }
    }
  } catch (e) {
    console.error('[sell/create] Supabase mirror sync failed (non-fatal):', e)
  }

  // ── Register subscription plans in Medusa (non-fatal) ────────────────────
  if (isSubscription && sellerId && clerkJwt) {
    const plansToCreate: Array<{
      label: string; price_cents: number; interval: string
      stripe_price_id?: string; description?: string
    }> = hasMultiTier
      ? tiersWithPriceIds.map(t => ({
          label: t.label,
          price_cents: t.price_cents,
          interval: t.interval,
          stripe_price_id: t.stripe_price_id,
        }))
      : [{
          label: sellerName ? `Suscripción — ${sellerName}` : 'Suscripción',
          price_cents: body.listing.price_cents ?? 0,
          interval: body.listing.subscription?.interval ?? 'month',
          stripe_price_id: singleTierStripePriceId ?? undefined,
        }]

    // Create plans via Medusa backend (fire-and-forget, non-fatal)
    Promise.all(
      plansToCreate.map(plan =>
        medusaFetch('/store/sellers/me/subscription-plans', clerkJwt, {
          method: 'POST',
          body: JSON.stringify({
            product_id: listingId,
            label: plan.label,
            description: plan.description ?? null,
            price_cents: plan.price_cents,
            currency: body.listing.currency?.toLowerCase() ?? 'mxn',
            interval: plan.interval,
            stripe_price_id: plan.stripe_price_id ?? null,
            metadata: { listing_id: listingId },
          }),
        }).catch(e => console.error('[sell/create] subscription plan creation failed:', e))
      )
    ).catch(() => {})
  }

  // ── Telegram notification ────────────────────────────────────────────────
  const priceCents = body.listing.price_cents
  const currency = body.listing.currency ?? 'MXN'
  const priceFmt = priceCents
    ? new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(priceCents / 100)
    : 'Precio a consultar'
  tg.newListing(titleClean, priceFmt, shopSlug, listingId)

  return NextResponse.json({ shopSlug, listingId }, { status: 201 })
}
