import 'server-only'
import { db } from './supabase'

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

export async function syncSupabaseListingMirror(
  shopId: string,
  listing: ListingForMirror,
) {
  const metadata = {
    ...(listing.metadata ?? {}),
    source: 'medusa',
    medusa_product_id: listing.id,
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
  }

  const { data: existing } = await db
    .from('marketplace_listings')
    .select('id')
    .eq('medusa_product_id', listing.id)
    .maybeSingle()

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
