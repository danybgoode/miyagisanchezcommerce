import { db } from './supabase'
import { canonicalSourceUrl } from './url'

export const SUPPLY_SOURCE_OPTIONS = [
  'mercadolibre',
  'inmuebles24',
  'google_local',
  'apify',
  'csv',
  'manual',
  'shopify',
] as const

export const SUPPLY_LISTING_TYPES = ['product', 'service', 'rental', 'digital'] as const

export const SUPPLY_ITEM_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'imported',
  'duplicate',
  'failed',
] as const

export type SupplySourcePlatform = typeof SUPPLY_SOURCE_OPTIONS[number]
export type SupplyListingType = typeof SUPPLY_LISTING_TYPES[number]
export type SupplyItemStatus = typeof SUPPLY_ITEM_STATUSES[number]

export interface SupplyBatch {
  id: string
  name: string
  source_platform: string
  source_mode: string
  category: string | null
  listing_type: SupplyListingType
  state: string | null
  municipio: string | null
  location: string | null
  target_status: string
  acquisition_settings: Record<string, unknown>
  status: string
  total_count: number
  approved_count: number
  rejected_count: number
  imported_count: number
  duplicate_count: number
  failed_count: number
  error_message: string | null
  created_at: string
  updated_at: string
  imported_at: string | null
}

export interface SupplyItem {
  id: string
  batch_id: string
  status: SupplyItemStatus
  quality_score: number
  duplicate_key: string | null
  source_platform: string
  source_url: string | null
  source_id: string | null
  shop_name: string | null
  shop_slug: string | null
  shop_source_url: string | null
  shop_description: string | null
  shop_location: string | null
  shop_logo_url: string | null
  shop_metadata: Record<string, unknown>
  listing_title: string | null
  listing_description: string | null
  price_cents: number | null
  currency: string
  condition: string | null
  listing_type: SupplyListingType
  category: string | null
  state: string | null
  municipio: string | null
  location: string | null
  images: Array<{ url: string; alt?: string }>
  tags: string[]
  listing_metadata: Record<string, unknown>
  raw_data: Record<string, unknown>
  error_message: string | null
  imported_shop_id: string | null
  imported_listing_id: string | null
  created_at: string
  updated_at: string
  imported_at: string | null
}

export interface IncomingSupplyItem {
  source_url?: string
  source_id?: string
  title?: string
  listing_title?: string
  description?: string
  listing_description?: string
  price?: string | number | null
  price_cents?: string | number | null
  currency?: string
  condition?: string
  listing_type?: string
  category?: string
  state?: string
  municipio?: string
  location?: string
  shop_name?: string
  seller?: string
  shop_source_url?: string
  shop_description?: string
  shop_location?: string
  shop_logo_url?: string
  image_url?: string
  images?: Array<{ url: string; alt?: string }> | string
  tags?: string[] | string
  metadata?: Record<string, unknown>
  raw_data?: Record<string, unknown>
}

export interface BatchDefaults {
  source_platform: string
  category?: string | null
  listing_type?: string | null
  state?: string | null
  municipio?: string | null
  location?: string | null
}

export interface GoogleLocalResult {
  title?: string
  place_id?: string
  address?: string
  phone?: string
  rating?: number
  reviews?: number
  type?: string
  thumbnail?: string
  website?: string
  gps_coordinates?: { latitude?: number; longitude?: number }
}

export function slugify(text: string, max = 48): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
}

// Canonicalization moved to the pure, dependency-free `lib/url.ts` so the client
// paste UI can reuse it without bundling this module's Supabase import. Re-exported
// here for back-compat with existing `lib/supply` importers + the usage below.
export { canonicalSourceUrl }

export function describeUrlSupport(source: string, mode: string): string {
  if (source === 'mercadolibre' && mode === 'direct_urls') {
    return 'Supported now: individual item URLs containing MLM-123... from articulo, auto, inmueble, or mercadolibre domains. Tracking query strings and #reco fragments are stripped automatically.'
  }
  if (source === 'mercadolibre' && mode === 'seller_urls') {
    return 'Seller/store URLs are accepted as research seeds, but this screen does not expand them into listings yet. Use item URLs or CSV rows for importable listings.'
  }
  if (source === 'inmuebles24') {
    return 'Use CSV rows exported from Apify or paste individual listing URLs. Search-result URLs are not expanded directly in this screen yet.'
  }
  if (source === 'google_local') {
    return 'Keyword + geography runs SerpAPI Google Local and stages businesses as service listings for review.'
  }
  if (source === 'apify') {
    return 'Paste Apify dataset rows as CSV. Native actor launching is intentionally not wired yet.'
  }
  return 'CSV mode accepts rows with headers. Direct URL mode accepts one original listing URL per line and creates a review row.'
}

export function normalizePriceCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    return value > 1000000 ? Math.round(value) : Math.round(value * 100)
  }
  const cleaned = value.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const parsed = Number.parseFloat(cleaned)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

function normalizeImages(item: IncomingSupplyItem, title: string | null): Array<{ url: string; alt?: string }> {
  if (Array.isArray(item.images)) {
    return item.images.filter(img => img.url).map(img => ({ url: img.url, alt: img.alt ?? title ?? undefined }))
  }
  if (typeof item.images === 'string' && item.images.trim()) {
    return item.images.split(/[,\n]/).map(url => url.trim()).filter(Boolean).map(url => ({ url, alt: title ?? undefined }))
  }
  if (item.image_url?.trim()) return [{ url: item.image_url.trim(), alt: title ?? undefined }]
  return []
}

function normalizeTags(tags: string[] | string | undefined): string[] {
  if (Array.isArray(tags)) return tags.map(t => t.trim()).filter(Boolean).slice(0, 20)
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
  return []
}

export function qualityScore(item: {
  listing_title: string | null
  source_url: string | null
  shop_name: string | null
  price_cents: number | null
  images: Array<{ url: string }>
  location: string | null
  listing_description: string | null
}): number {
  let score = 0
  if (item.listing_title && item.listing_title.trim().length >= 5) score += 2
  if (item.source_url) score += 2
  if (item.shop_name && item.shop_name.trim().length >= 2) score += 1
  if (item.price_cents !== null) score += 1
  if (item.images.length > 0) score += 1
  if (item.location) score += 1
  if (item.listing_description && item.listing_description.trim().length >= 20) score += 1
  return score
}

export function normalizeSupplyItem(input: IncomingSupplyItem, defaults: BatchDefaults) {
  const listingTitle = String(input.listing_title ?? input.title ?? '').trim() || null
  const shopName = String(input.shop_name ?? input.seller ?? '').trim() || null
  const sourceUrl = canonicalSourceUrl(String(input.source_url ?? '').trim())
  const location = String(input.location ?? defaults.location ?? '').trim() || null
  const images = normalizeImages(input, listingTitle)
  const priceCents = normalizePriceCents(input.price_cents ?? input.price)
  const listingType = SUPPLY_LISTING_TYPES.includes(input.listing_type as SupplyListingType)
    ? input.listing_type as SupplyListingType
    : (defaults.listing_type as SupplyListingType | null) ?? 'product'
  const category = String(input.category ?? defaults.category ?? '').trim() || null
  const state = String(input.state ?? defaults.state ?? '').trim() || null
  const municipio = String(input.municipio ?? defaults.municipio ?? '').trim() || null
  const duplicateSource = sourceUrl ?? [
    defaults.source_platform,
    shopName,
    listingTitle,
    priceCents ?? '',
    location ?? '',
  ].filter(Boolean).join('|')

  const normalized = {
    status: 'pending_review' as SupplyItemStatus,
    source_platform: defaults.source_platform,
    source_url: sourceUrl,
    source_id: String(input.source_id ?? '').trim() || null,
    shop_name: shopName,
    shop_slug: shopName ? slugify(shopName, 44) : null,
    shop_source_url: String(input.shop_source_url ?? '').trim() || sourceUrl,
    shop_description: String(input.shop_description ?? '').trim() || null,
    shop_location: String(input.shop_location ?? location ?? '').trim() || null,
    shop_logo_url: String(input.shop_logo_url ?? '').trim() || null,
    shop_metadata: {},
    listing_title: listingTitle,
    listing_description: String(input.listing_description ?? input.description ?? '').trim() || null,
    price_cents: priceCents,
    currency: String(input.currency ?? 'MXN').trim().toUpperCase() || 'MXN',
    condition: String(input.condition ?? '').trim() || null,
    listing_type: listingType,
    category,
    state,
    municipio,
    location,
    images,
    tags: normalizeTags(input.tags),
    listing_metadata: input.metadata ?? {},
    raw_data: input.raw_data ?? input as Record<string, unknown>,
    duplicate_key: slugify(duplicateSource, 120) || null,
  }

  return {
    ...normalized,
    quality_score: qualityScore(normalized),
  }
}

export function googleLocalToSupplyItem(result: GoogleLocalResult, defaults: BatchDefaults, query: string): IncomingSupplyItem {
  const placeId = result.place_id ?? null
  const sourceUrl = placeId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(result.title ?? query)}&query_place_id=${encodeURIComponent(placeId)}`
    : `google-local://${encodeURIComponent(`${result.title ?? query}|${result.address ?? defaults.location ?? ''}`)}`

  return {
    source_url: sourceUrl,
    source_id: placeId ?? undefined,
    title: result.title,
    description: [result.type, result.address].filter(Boolean).join(' - '),
    shop_name: result.title,
    shop_source_url: result.website ?? sourceUrl,
    shop_location: result.address ?? defaults.location ?? undefined,
    image_url: result.thumbnail,
    category: defaults.category ?? 'servicios',
    listing_type: 'service',
    state: defaults.state ?? undefined,
    municipio: defaults.municipio ?? undefined,
    location: result.address ?? defaults.location ?? undefined,
    metadata: {
      phone: result.phone ?? null,
      website: result.website ?? null,
      rating: result.rating ?? null,
      reviews: result.reviews ?? null,
      business_type: result.type ?? null,
      lat: result.gps_coordinates?.latitude ?? null,
      lng: result.gps_coordinates?.longitude ?? null,
      query,
    },
    raw_data: result as Record<string, unknown>,
  }
}

// ── Medusa import mappers (pure — unit-tested, keep next-free) ────────────────
// The import hop creates REAL Medusa sellers + products (the storefront's only
// read model) and mirrors them to Supabase afterwards. These mappers define
// that translation in one testable place.

export interface UnclaimedSellerBody {
  name: string
  slug?: string
  description?: string | null
  location?: string | null
  logo_url?: string | null
  source: string
  source_url?: string | null
  metadata: Record<string, unknown>
}

export function supplyItemToSellerBody(item: SupplyItem): UnclaimedSellerBody {
  const shopSourceUrl = item.shop_source_url ?? item.source_url
  return {
    name: (item.shop_name?.trim() || 'Vendedor sin reclamar').slice(0, 80),
    ...(item.shop_slug ? { slug: item.shop_slug } : {}),
    description: item.shop_description,
    location: item.shop_location ?? item.location,
    logo_url: item.shop_logo_url,
    source: 'scraped',
    source_url: shopSourceUrl,
    metadata: {
      ...(item.shop_metadata ?? {}),
      supply: {
        batch_id: item.batch_id,
        item_id: item.id,
        source_platform: item.source_platform,
        unclaimed: true,
      },
    },
  }
}

export interface MedusaProductImportBody {
  seller_slug: string
  title: string
  description: string | null
  price_cents: number | null
  currency: string
  condition: string | null
  listing_type: string
  category: string | null
  state: string | null
  municipio: string | null
  location: string | null
  status: 'published' | 'draft'
  images: Array<{ url: string; alt?: string }>
  tags: string[]
  metadata: Record<string, unknown>
}

export function supplyItemToProductBody(
  item: SupplyItem,
  sellerSlug: string,
  targetStatus: string,
): MedusaProductImportBody {
  return {
    seller_slug: sellerSlug,
    title: (item.listing_title ?? '').trim().slice(0, 100),
    description: item.listing_description,
    price_cents: item.price_cents,
    currency: item.currency || 'MXN',
    condition: item.listing_type === 'product' ? item.condition : null,
    listing_type: item.listing_type || 'product',
    category: item.category,
    state: item.state,
    municipio: item.municipio,
    location: item.location,
    // Legacy batches say 'active'; Medusa products are 'published' | 'draft'.
    status: targetStatus === 'draft' ? 'draft' : 'published',
    images: item.images ?? [],
    tags: item.tags ?? [],
    metadata: {
      ...(item.listing_metadata ?? {}),
      original_source_url: item.source_url,
      source_platform: item.source_platform,
      source_url: item.source_url,
      supply: {
        batch_id: item.batch_id,
        item_id: item.id,
        source_id: item.source_id,
        quality_score: item.quality_score,
        unclaimed_shop: true,
      },
    },
  }
}

export async function refreshBatchCounts(batchId: string) {
  const { data } = await db
    .from('supply_items')
    .select('status')
    .eq('batch_id', batchId)

  const counts = {
    total_count: data?.length ?? 0,
    approved_count: 0,
    rejected_count: 0,
    imported_count: 0,
    duplicate_count: 0,
    failed_count: 0,
  }

  for (const item of data ?? []) {
    if (item.status === 'approved') counts.approved_count++
    if (item.status === 'rejected') counts.rejected_count++
    if (item.status === 'imported') counts.imported_count++
    if (item.status === 'duplicate') counts.duplicate_count++
    if (item.status === 'failed') counts.failed_count++
  }

  await db.from('supply_batches').update(counts).eq('id', batchId)
  return counts
}
