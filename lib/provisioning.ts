import 'server-only'
import { db } from './supabase'
import { generateShortCode } from './shortlink'

/** Mint a short code not yet used by any listing (for mschz.org/[code]). */
async function ensureUniqueShortCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateShortCode()
    const { data } = await db
      .from('marketplace_listings')
      .select('id')
      .contains('metadata', { short_code: code })
      .maybeSingle()
    if (!data) return code
  }
  // Extremely unlikely; widen the code rather than fail the mirror sync.
  return generateShortCode(9)
}

export interface MedusaSellerForMirror {
  id: string
  slug: string
  name: string
  description?: string | null
  location?: string | null
  logo_url?: string | null
  verified?: boolean | null
  metadata?: Record<string, unknown> | null
}

export interface ListingForMirror {
  id: string
  title: string
  description?: string | null
  price_cents?: number | null
  currency?: string | null
  condition?: string | null
  listing_type?: string | null
  category?: string | null
  state?: string | null
  municipio?: string | null
  location?: string | null
  images?: Array<{ url: string; alt?: string | null }>
  tags?: string[]
  status?: string | null
  metadata?: Record<string, unknown> | null
  // Provenance (supply-imported listings) — also powers source_url dup detection.
  source?: string | null
  source_platform?: string | null
  source_url?: string | null
}

interface SupabaseShopMirror {
  id: string
  slug: string
  metadata: Record<string, unknown> | null
}

function medusaMetadata(existing: Record<string, unknown> | null, sellerId: string) {
  return {
    ...(existing ?? {}),
    source: 'medusa',
    medusa_seller_id: sellerId,
  }
}

async function uniqueFallbackSlug(baseSlug: string, clerkUserId: string) {
  const suffix = clerkUserId.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, '')
  let slug = `${baseSlug}-${suffix || 'seller'}`
  let attempt = 1

  while (true) {
    const { data } = await db
      .from('marketplace_shops')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (!data) return slug
    slug = `${baseSlug}-${suffix || 'seller'}-${++attempt}`
  }
}

export async function ensureSupabaseShopMirror(
  seller: MedusaSellerForMirror,
  clerkUserId: string,
): Promise<SupabaseShopMirror | null> {
  const { data: byUser } = await db
    .from('marketplace_shops')
    .select('id, slug, metadata')
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (byUser) {
    const update = {
      slug: seller.slug,
      name: seller.name,
      description: seller.description ?? null,
      location: seller.location ?? null,
      logo_url: seller.logo_url ?? null,
      verified: seller.verified ?? false,
      metadata: medusaMetadata((byUser.metadata ?? {}) as Record<string, unknown>, seller.id),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await db
      .from('marketplace_shops')
      .update(update)
      .eq('id', byUser.id)
      .select('id, slug, metadata')
      .maybeSingle()

    if (error) {
      console.error('[provisioning] Supabase shop mirror update failed:', error)
      return byUser as SupabaseShopMirror
    }
    return (data ?? byUser) as SupabaseShopMirror
  }

  const { data: bySlug } = await db
    .from('marketplace_shops')
    .select('id, slug, clerk_user_id, metadata')
    .eq('slug', seller.slug)
    .maybeSingle()

  if (bySlug && (!bySlug.clerk_user_id || bySlug.clerk_user_id === clerkUserId)) {
    const { data, error } = await db
      .from('marketplace_shops')
      .update({
        name: seller.name,
        description: seller.description ?? null,
        location: seller.location ?? null,
        logo_url: seller.logo_url ?? null,
        clerk_user_id: clerkUserId,
        verified: seller.verified ?? false,
        metadata: medusaMetadata((bySlug.metadata ?? {}) as Record<string, unknown>, seller.id),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bySlug.id)
      .select('id, slug, metadata')
      .maybeSingle()

    if (error) {
      console.error('[provisioning] Supabase shop mirror claim failed:', error)
      return null
    }
    return data as SupabaseShopMirror
  }

  const slug = bySlug ? await uniqueFallbackSlug(seller.slug, clerkUserId) : seller.slug
  const { data, error } = await db
    .from('marketplace_shops')
    .insert({
      slug,
      name: seller.name,
      description: seller.description ?? null,
      location: seller.location ?? null,
      logo_url: seller.logo_url ?? null,
      clerk_user_id: clerkUserId,
      verified: seller.verified ?? false,
      source: 'medusa',
      metadata: medusaMetadata(seller.metadata ?? {}, seller.id),
    })
    .select('id, slug, metadata')
    .maybeSingle()

  if (error) {
    console.error('[provisioning] Supabase shop mirror insert failed:', error)
    return null
  }

  return data as SupabaseShopMirror
}

/**
 * Mirror an UNCLAIMED (supply-imported) Medusa seller into marketplace_shops.
 * Unlike ensureSupabaseShopMirror there is no Clerk user — the row keeps
 * clerk_user_id NULL until the claim flow transfers it. Keyed by
 * metadata.medusa_seller_id, falling back to the slug. Returns the mirror row
 * id, or null on failure (mirror is non-fatal — the storefront renders from
 * Medusa; only conversations/offers/short links degrade).
 */
export async function ensureUnclaimedShopMirror(
  seller: MedusaSellerForMirror & { source?: string | null; source_url?: string | null },
): Promise<string | null> {
  const { data: byMedusaId } = await db
    .from('marketplace_shops')
    .select('id')
    .contains('metadata', { medusa_seller_id: seller.id })
    .maybeSingle()
  if (byMedusaId) return byMedusaId.id as string

  const { data: bySlug } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('slug', seller.slug)
    .maybeSingle()

  if (bySlug) {
    await db
      .from('marketplace_shops')
      .update({ metadata: medusaMetadata((bySlug.metadata ?? {}) as Record<string, unknown>, seller.id) })
      .eq('id', bySlug.id)
    return bySlug.id as string
  }

  const { data, error } = await db
    .from('marketplace_shops')
    .insert({
      slug: seller.slug,
      name: seller.name,
      description: seller.description ?? null,
      location: seller.location ?? null,
      logo_url: seller.logo_url ?? null,
      clerk_user_id: null,
      verified: seller.verified ?? false,
      source: seller.source ?? 'scraped',
      source_url: seller.source_url ?? null,
      metadata: medusaMetadata(seller.metadata ?? {}, seller.id),
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[provisioning] unclaimed shop mirror insert failed:', error)
    return null
  }
  return (data?.id as string | undefined) ?? null
}

export async function syncSupabaseListingMirror(
  shopId: string,
  listing: ListingForMirror,
) {
  // Preserve an existing short code; mint one for new listings (the mschz.org/[code]
  // short link — every listing gets one).
  const { data: existing } = await db
    .from('marketplace_listings')
    .select('id, metadata')
    .eq('medusa_product_id', listing.id)
    .maybeSingle()

  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>
  const shortCode = (typeof existingMeta.short_code === 'string' && existingMeta.short_code)
    || await ensureUniqueShortCode()

  const metadata = {
    ...(listing.metadata ?? {}),
    source: 'medusa',
    medusa_product_id: listing.id,
    short_code: shortCode,
    // Keep a seller-set custom slug if one already exists (US-4).
    ...(typeof existingMeta.short_slug === 'string' ? { short_slug: existingMeta.short_slug } : {}),
  }

  const payload = {
    shop_id: shopId,
    medusa_product_id: listing.id,
    title: listing.title,
    description: listing.description ?? null,
    price_cents: listing.price_cents ?? null,
    currency: (listing.currency ?? 'MXN').toUpperCase(),
    condition: listing.condition ?? null,
    listing_type: listing.listing_type ?? 'product',
    category: listing.category ?? null,
    state: listing.state ?? null,
    municipio: listing.municipio ?? null,
    location: listing.location ?? null,
    images: listing.images ?? [],
    tags: listing.tags ?? [],
    status: listing.status ?? 'active',
    metadata,
    updated_at: new Date().toISOString(),
    ...(listing.source !== undefined ? { source: listing.source } : {}),
    ...(listing.source_platform !== undefined ? { source_platform: listing.source_platform } : {}),
    ...(listing.source_url !== undefined ? { source_url: listing.source_url } : {}),
  }

  if (existing) {
    const { error } = await db
      .from('marketplace_listings')
      .update(payload)
      .eq('id', existing.id)

    if (error) console.error('[provisioning] Supabase listing mirror update failed:', error)
    return existing.id as string
  }

  const { data, error } = await db
    .from('marketplace_listings')
    .insert(payload)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[provisioning] Supabase listing mirror insert failed:', error)
    return null
  }

  return data?.id as string | undefined
}
