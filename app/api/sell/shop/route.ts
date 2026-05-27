import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/supabase'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

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
      whatsapp_cta?: boolean
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
    const clerkJwt = await getToken()
    const medusaToken = clerkJwt ? await getMedusaToken(clerkJwt) : null
    if (medusaToken) {
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
        await fetch(`${MEDUSA_BASE}/store/sellers/me`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-publishable-api-key': PUB_KEY,
            Authorization: `Bearer ${medusaToken}`,
          },
          body: JSON.stringify(medusaPayload),
        })
      }
    }
  } catch (e) {
    console.error('[shop/settings] Medusa seller sync failed (non-fatal):', e)
  }

  // Bust listing + shop page caches so PDP/storefront reflect new settings immediately
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true })
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
