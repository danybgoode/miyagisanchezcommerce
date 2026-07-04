import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/supabase'
import { syncMedusaSellerProfile } from '@/lib/medusa-seller-sync'
import { ensureSupabaseShopMirror, type MedusaSellerForMirror } from '@/lib/provisioning'
import { normalizeSupportSettings } from '@/lib/support-widget'
import { tg } from '@/lib/telegram'
import { httpUrl } from '@/lib/settings-import'

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

// ── POST — create the seller/shop on its own (before any listing exists) ──────
// Decouples shop creation from listing creation: the onboarding wizard calls this
// when Step 1 (shop info) completes, so abandoning before publishing a listing
// still leaves a reachable /shop/manage. Idempotent — returns the existing seller
// if one is already provisioned.

interface ShopCreatePayload {
  name?: string
  slug?: string
  state?: string
  city?: string
  description?: string
}

export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: ShopCreatePayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  // Idempotent: if a Medusa seller already exists, return it unchanged.
  const existingRes = await medusaFetch('/store/sellers/me', clerkJwt)
  if (existingRes.ok) {
    const { seller } = await existingRes.json() as { seller: MedusaSellerForMirror }
    await ensureSupabaseShopMirror(seller, userId).catch(() => {})
    return NextResponse.json({ shopSlug: seller.slug }, { status: 200 })
  }
  if (existingRes.status !== 404) {
    const errBody = await existingRes.json().catch(() => ({})) as { message?: string }
    console.error('[sell/shop] sellers/me failed:', existingRes.status, errBody)
    return NextResponse.json({ error: errBody.message ?? 'Error al verificar tu tienda.' }, { status: 500 })
  }

  // No seller yet — create one. Mirror the validation in /api/sell/create.
  let shopName = body.name?.trim() ?? ''
  if (!shopName) {
    const clerkUser = await currentUser()
    shopName = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ')
      || clerkUser?.emailAddresses[0]?.emailAddress?.split('@')[0]
      || 'Mi tienda'
  }
  if (shopName.length < 2) {
    return NextResponse.json({ error: 'El nombre de la tienda debe tener al menos 2 caracteres.', field: 'name' }, { status: 422 })
  }
  if (shopName.length > 80) {
    return NextResponse.json({ error: 'El nombre no puede superar los 80 caracteres.', field: 'name' }, { status: 422 })
  }

  const location = [body.city?.trim(), body.state?.trim()].filter(Boolean).join(', ') || null

  const createRes = await medusaFetch('/store/sellers/me', clerkJwt, {
    method: 'POST',
    body: JSON.stringify({
      name: shopName,
      // Optional seller-chosen slug; the backend slugifies + de-dupes it, and
      // falls back to slugifying the name when absent.
      ...(body.slug?.trim() && { slug: body.slug.trim() }),
      description: body.description?.trim() || null,
      location,
    }),
  })
  const createData = await createRes.json()
  if (!createRes.ok || !createData.seller) {
    console.error('[sell/shop] seller creation failed:', createRes.status, createData)
    return NextResponse.json({ error: 'No se pudo crear la tienda. Inténtalo de nuevo.' }, { status: 500 })
  }

  const seller = createData.seller as MedusaSellerForMirror
  await ensureSupabaseShopMirror(seller, userId).catch((e) => {
    console.error('[sell/shop] Supabase mirror sync failed (non-fatal):', e)
  })

  // Net-new shop only — ping the ops chat (fire-and-forget). The idempotent
  // already-exists branch above returns before reaching here, so a re-POST
  // never double-pings.
  tg.newShop(shopName, location, seller.slug)

  return NextResponse.json({ shopSlug: seller.slug }, { status: 201 })
}

// ── PATCH — update shop profile + settings ───────────────────────────────────

interface ShopUpdatePayload {
  name?: string
  description?: string
  state?: string
  city?: string
  logo_url?: string | null
  mp_enabled?: boolean
  stripe_enabled?: boolean
  ucp_webhook_url?: string | null
  ucp_webhook_secret?: string | null
  // metadata.settings fields
  settings?: {
    preset?: string
    checkout?: {
      escrow_mode?: 'off' | 'optional' | 'required'
      payment_methods?: string[]
      show_phone?: boolean
      phone?: string | null
      whatsapp_cta?: boolean
      show_email?: boolean
      contact_email?: string | null
      bank_transfer?: {
        enabled?: boolean
        clabe?: string | null
        bank_name?: string | null
        account_holder?: string | null
      }
    }
    shipping?: {
      mercado_envios?: boolean
      local_pickup?: boolean
      custom_rates?: boolean
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
      pickup_spots?: Array<{ name?: string; address?: string; instructions?: string }>
      origin_address?: Record<string, string | null>
    }
    notifications?: {
      email_new_view?: boolean
      email_new_message?: boolean
    }
    theme?: {
      banner_url?: string | null
      accent_color?: string | null
      tagline?: string | null
      social?: {
        instagram?: string
        facebook?: string
        whatsapp?: string
        tiktok?: string
        twitter?: string
      }
    }
    // Own-shop premium presentation (epic 07, Sprint 1) — siblings of `theme`,
    // not nested inside it (see lib/shop-settings/types.ts).
    announcement?: { text: string; link?: string | null } | null
    hero?: {
      mode: 'listings' | 'promo'
      pinned_listing_ids?: string[]
      promo_image_url?: string | null
      promo_cta_text?: string | null
      promo_cta_link?: string | null
    } | null
    theme_preset?: string | null
    offers?: {
      min_buyer_trust_level?: string
      negotiation?: {
        enabled?: boolean
        auto_accept_pct?: number
        auto_decline_pct?: number
        auto_counter_pct?: number
      }
    }
    scheduling?: {
      links?: Array<{ label: string; url: string }>
    }
    orders?: {
      processing_time?: string
      auto_accept?: boolean
      dispatch_window_days?: number
      auto_confirm_days?: number
    }
    returns_policy?: {
      window?: string
      conditions?: string
      shipping_paid_by?: 'buyer' | 'seller'
      custom_note?: string | null
    } | null
    support?: {
      enabled?: boolean
      preset_amount_cents?: number[]
      custom_min_cents?: number
      custom_max_cents?: number
      currency?: string
      default_visibility?: 'public' | 'private'
      support_product_id?: string | null
    }
  }
}

export async function PATCH(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: ShopUpdatePayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  // ── Validation ────────────────────────────────────────────────────────────
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (name.length < 2) return NextResponse.json({ error: 'El nombre debe tener al menos 2 caracteres.', field: 'name' }, { status: 422 })
    if (name.length > 80) return NextResponse.json({ error: 'El nombre no puede superar los 80 caracteres.', field: 'name' }, { status: 422 })
  }
  if (body.description !== undefined && body.description.length > 500) {
    return NextResponse.json({ error: 'La descripción no puede superar los 500 caracteres.', field: 'description' }, { status: 422 })
  }
  // Own-shop premium presentation (epic 07, Sprint 1) — these render straight into
  // a public href/src (AnnouncementBar/HeroSection), so this route enforces the
  // exact same http(s)-only rule as the MCP/Storefront-as-Code path
  // (lib/settings-import.ts's httpUrl) — the seller-UI save path must not be a
  // second, unvalidated way for a non-http(s) scheme (e.g. `javascript:`) to
  // reach a rendered link.
  const announcementLink = body.settings?.announcement?.link
  if (announcementLink !== undefined && announcementLink !== null && !httpUrl(announcementLink)) {
    return NextResponse.json({ error: 'El enlace del anuncio debe ser una URL http/https.', field: 'announcement' }, { status: 422 })
  }
  const heroPromoImage = body.settings?.hero?.promo_image_url
  if (heroPromoImage !== undefined && heroPromoImage !== null && !httpUrl(heroPromoImage)) {
    return NextResponse.json({ error: 'La imagen del destacado debe ser una URL http/https.', field: 'hero' }, { status: 422 })
  }
  const heroPromoLink = body.settings?.hero?.promo_cta_link
  if (heroPromoLink !== undefined && heroPromoLink !== null && !httpUrl(heroPromoLink)) {
    return NextResponse.json({ error: 'El enlace del botón destacado debe ser una URL http/https.', field: 'hero' }, { status: 422 })
  }

  // ── Fetch current shop ────────────────────────────────────────────────────
  const { data: shop, error: fetchErr } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (fetchErr || !shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  // ── Build update payload ──────────────────────────────────────────────────
  const location = [body.city?.trim(), body.state?.trim()].filter(Boolean).join(', ') || undefined

  // Deep-merge settings into existing metadata
  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const existingSettings = (existingMeta.settings ?? {}) as Record<string, unknown>

  let settingsOverride = body.settings ? (body.settings as Record<string, unknown>) : {}
  let clerkJwtForMedusa: string | null = null
  let supportProductId: string | null = null

  const checkoutOverride = (settingsOverride.checkout ?? null) as Record<string, unknown> | null
  if (checkoutOverride && Object.prototype.hasOwnProperty.call(checkoutOverride, 'show_email')) {
    const user = await currentUser()
    const email =
      user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses[0]?.emailAddress ??
      null

    settingsOverride = {
      ...settingsOverride,
      checkout: {
        ...checkoutOverride,
        contact_email: checkoutOverride.show_email === true ? email : null,
      },
    }
  }

  if (Object.prototype.hasOwnProperty.call(settingsOverride, 'support')) {
    const normalizedSupport = normalizeSupportSettings(settingsOverride.support)
    if (!normalizedSupport.ok) {
      return NextResponse.json(
        { error: normalizedSupport.error, field: normalizedSupport.field },
        { status: 422 },
      )
    }

    let supportSettings = normalizedSupport.settings
    if (supportSettings.enabled) {
      clerkJwtForMedusa = await getToken()
      if (!clerkJwtForMedusa) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

      const provisionRes = await medusaFetch('/store/sellers/me/support-product', clerkJwtForMedusa, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const provisionData = await provisionRes.json().catch(() => ({})) as { product_id?: string; message?: string }
      if (!provisionRes.ok || !provisionData.product_id) {
        console.error('[sell/shop] support product provision failed:', provisionRes.status, provisionData)
        return NextResponse.json(
          { error: provisionData.message ?? 'No se pudo preparar el producto de apoyos.', field: 'support' },
          { status: 502 },
        )
      }
      supportProductId = provisionData.product_id
      supportSettings = { ...supportSettings, support_product_id: supportProductId }
    }

    settingsOverride = { ...settingsOverride, support: supportSettings }
  }

  // Merge stripe_enabled into metadata.settings.stripe
  if (body.stripe_enabled !== undefined) {
    const existingStripe = (existingSettings.stripe ?? {}) as Record<string, unknown>
    settingsOverride = { ...settingsOverride, stripe: { ...existingStripe, enabled: body.stripe_enabled } }
  }

  const mergedSettings = Object.keys(settingsOverride).length > 0
    ? deepMerge(existingSettings, settingsOverride)
    : existingSettings

  const updates: Record<string, unknown> = {
    metadata: { ...existingMeta, settings: mergedSettings },
  }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.description !== undefined) updates.description = body.description.trim() || null
  if (location !== undefined) updates.location = location
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url
  if (body.mp_enabled !== undefined) updates.mp_enabled = body.mp_enabled
  if (body.ucp_webhook_url !== undefined) updates.ucp_webhook_url = body.ucp_webhook_url
  if (body.ucp_webhook_secret !== undefined) updates.ucp_webhook_secret = body.ucp_webhook_secret

  const { error } = await db
    .from('marketplace_shops')
    .update(updates)
    .eq('id', shop.id)

  if (error) {
    console.error('Shop update error:', error)
    return NextResponse.json({ error: 'Error al guardar cambios.' }, { status: 500 })
  }

  // ── Sync profile fields to Medusa seller record (non-fatal) ─────────────────
  try {
    const clerkJwt = clerkJwtForMedusa ?? await getToken()
    if (clerkJwt) {
      const medusaPayload: Record<string, unknown> = {}
      if (body.name !== undefined) medusaPayload.name = body.name.trim()
      if (body.description !== undefined) medusaPayload.description = body.description.trim() || null
      if (location !== undefined) medusaPayload.location = location
      if (body.logo_url !== undefined) medusaPayload.logo_url = body.logo_url
      // Store the full settings blob in Medusa seller metadata so the MCP/UCP
      // layer can read payment methods, escrow mode, and scheduling config.
      if (body.settings || body.mp_enabled !== undefined) {
        medusaPayload.metadata = {
          settings: mergedSettings,
          ...(body.mp_enabled !== undefined && { mp_enabled: body.mp_enabled }),
        }
      }
      if (Object.keys(medusaPayload).length > 0) {
        await syncMedusaSellerProfile(clerkJwt, medusaPayload)
      }
    }
  } catch (e) {
    console.error('[shop/settings] Medusa seller sync failed (non-fatal):', e)
  }

  // Bust listing + shop page caches so PDP/storefront reflect new settings immediately
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true, ...(supportProductId ? { support_product_id: supportProductId } : {}) })
}

// ── Utility: shallow/deep merge ───────────────────────────────────────────────

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const bv = base[key]
    const ov = override[key]
    if (ov !== null && typeof ov === 'object' && !Array.isArray(ov) &&
        bv !== null && typeof bv === 'object' && !Array.isArray(bv)) {
      result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>)
    } else {
      result[key] = ov
    }
  }
  return result
}
