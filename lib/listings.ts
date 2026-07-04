import { unstable_cache } from 'next/cache'
import type { Listing, Shop, SearchParams } from './types'
import { CATEGORIES } from './types'
import { CACHE } from './cache-policy'
import { buildQuery, isPrintPlacementListing } from './listing-query'
import {
  pickFeatured,
  curateGrid,
  curatedGridSize,
  liveCategoryCounts,
  windowSeed,
  unionById,
  type CategoryCount,
} from './home-curation'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'x-publishable-api-key': PUB_KEY,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
}

export async function searchListings(
  params: SearchParams,
): Promise<{ listings: Listing[]; total: number; page: number }> {
  const page = Math.max(1, parseInt(params.page ?? '1'))
  const qs = buildQuery({ ...params, page: String(page), limit: 24 })

  const res = await medusaFetch(`/store/listings${qs}`, {
    next: { revalidate: CACHE.CATALOG, tags: ['listings'] },
  } as RequestInit)

  if (!res.ok) {
    console.error('[listings] searchListings failed', res.status, await res.text())
    return { listings: [], total: 0, page }
  }

  const data = await res.json()
  return { listings: data.listings ?? [], total: data.total ?? 0, page: data.page ?? page }
}

// Lightweight total-only count for the mobile filter sheet's live "Ver X
// resultados". Same backend filter pipeline as searchListings (so the count is
// exact), but asks for a single row and returns only the total.
export async function countListings(params: SearchParams): Promise<number> {
  const qs = buildQuery({ ...params, page: '1', limit: 1 })

  const res = await medusaFetch(`/store/listings${qs}`, {
    next: { revalidate: CACHE.CATALOG, tags: ['listings'] },
  } as RequestInit)

  if (!res.ok) {
    console.error('[listings] countListings failed', res.status, await res.text())
    return 0
  }

  const data = await res.json()
  return data.total ?? 0
}

export const getListing = unstable_cache(
  async (id: string): Promise<Listing | null> => {
    const res = await medusaFetch(`/store/listings/${id}`)
    if (!res.ok) return null
    const data = await res.json()
    const listing = data.listing ?? null

    // Increment view count fire-and-forget via a PATCH on the seller product metadata
    // (async, does not block rendering)
    if (listing) {
      const newViews = (listing.metadata?.views as number ?? 0) + 1
      medusaFetch(`/store/listings/${id}/view`, {
        method: 'POST',
        body: JSON.stringify({ views: newViews }),
      }).catch(() => {})
    }

    return listing
  },
  ['listing'],
  { revalidate: CACHE.LISTING, tags: ['listings'] },
)

export const getShop = unstable_cache(
  async (slug: string): Promise<Shop | null> => {
    const res = await medusaFetch(`/store/sellers/${slug}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.seller ?? null
  },
  ['shop'],
  { revalidate: CACHE.SHOP, tags: ['shops'] },
)

export const getShopListings = unstable_cache(
  async (sellerSlug: string): Promise<Listing[]> => {
    const res = await medusaFetch(`/store/sellers/${sellerSlug}/products`, {
      next: { revalidate: CACHE.LISTING, tags: ['listings'] },
    } as RequestInit)
    if (!res.ok) return []
    const data = await res.json()

    // Map seller products to Listing shape. Print-ad placement products (sold
    // only through the dedicated print-edition flow) are excluded here — this
    // is the shop-storefront seam every buyer-facing surface reads through
    // (marketplace /s/[slug], subdomain, custom domain, embed, sitemap, PDP
    // "more from this shop"), matching the general-catalog exclusion already
    // live in the backend /store/listings route.
    const seller = data.seller
    return (data.products ?? [])
      .filter((p: any) => !isPrintPlacementListing(p.metadata))
      .map((p: any) => {
        const meta = (p.metadata ?? {}) as Record<string, unknown>
        const variant = p.variants?.[0]
        const mxnPrice = variant?.prices?.find((pr: any) => pr.currency_code === 'mxn')
        const priceObj = mxnPrice ?? variant?.prices?.[0]
        const fallbackPrice = typeof meta.price_cents === 'number' ? meta.price_cents : null
        const manageInventory = !!variant?.manage_inventory
        const availableQuantity = manageInventory
          ? (variant?.inventory_items ?? [])
              .flatMap((ii: any) => ii?.inventory?.location_levels ?? [])
              .reduce((sum: number, lvl: any) =>
                sum + (Number(lvl?.stocked_quantity ?? 0) - Number(lvl?.reserved_quantity ?? 0)), 0)
          : null
        return {
          id: p.id,
          shop_id: seller?.id ?? '',
          medusa_product_id: p.id,
          title: p.title,
          description: p.description ?? null,
          price_cents: priceObj?.amount ?? fallbackPrice,
          currency: (priceObj?.currency_code ?? (meta.currency as string | undefined) ?? 'mxn').toUpperCase(),
          condition: (meta.condition as string) ?? null,
          listing_type: p.type?.value ?? (meta.listing_type as string | undefined) ?? 'product',
          category: p.categories?.[0]?.handle ?? null,
          state: (meta.state as string) ?? null,
          municipio: (meta.municipio as string) ?? null,
          location: (meta.location as string) ?? null,
          attrs: (meta.attrs as Record<string, unknown> | undefined) ?? {},
          metadata: meta,
          images: (p.images ?? []).map((img: any) => ({ url: img.url, alt: img.metadata?.alt ?? null })),
          tags: (p.tags ?? []).map((t: any) => t.value),
          status: p.status === 'published' ? 'active' : p.status,
          source_platform: (meta.source_platform as string) ?? null,
          source_url: (meta.source_url as string) ?? null,
          views: (meta.views as number) ?? 0,
          manage_inventory: manageInventory,
          available_quantity: availableQuantity,
          in_stock: !manageInventory || (availableQuantity ?? 0) > 0,
          created_at: p.created_at,
          shop: seller ? {
            id: seller.id,
            slug: seller.slug,
            name: seller.name,
            description: seller.description ?? null,
            location: seller.location ?? null,
            logo_url: seller.logo_url ?? null,
            clerk_user_id: seller.clerk_user_id ?? null,
            verified: seller.verified ?? false,
            source: seller.source ?? null,
            source_url: seller.source_url ?? null,
            metadata: seller.metadata ?? null,
            created_at: seller.created_at ?? p.created_at,
            custom_domain: null,
            custom_domain_verified: false,
            custom_domain_vercel_ok: false,
          } : null,
        } as Listing
      })
  },
  ['shop-listings'],
  { revalidate: CACHE.LISTING, tags: ['listings'] },
)

export async function getRecentListings(limit = 8): Promise<Listing[]> {
  const res = await medusaFetch(`/store/listings?sort=reciente&limit=${limit}`, {
    next: { revalidate: CACHE.LISTING, tags: ['listings'] },
  } as RequestInit)
  if (!res.ok) return []
  const data = await res.json()
  return data.listings ?? []
}

/**
 * Candidate listings for the `/admin/seleccion` curation screen — the freshest
 * pool the admin can pin from. Tagged `listings` so a pin write (`revalidateTag`)
 * refreshes it. v1 surfaces the freshest `limit`; pinning a product older than
 * that needs the search follow-up noted in sprint-2.md.
 */
export async function getSeleccionCandidates(limit = 50): Promise<Listing[]> {
  const res = await medusaFetch(`/store/listings?sort=reciente&limit=${limit}`, {
    next: { revalidate: CACHE.LISTING, tags: ['listings'] },
  } as RequestInit)
  if (!res.ok) return []
  const data = await res.json()
  return data.listings ?? []
}

// ── Homepage Polish — Dirección B · Sprint 2: curated Selección + Categorías ──
// The curation/count *logic* lives in the next-free `lib/home-curation.ts` seam
// (unit-tested by `e2e/home-curation.spec.ts`); these are the thin Medusa-reading
// wrappers. One cached pool feeds both featured + grid so they stay consistent.

// A small pool of the freshest listings UNIONed with the explicit pinned set
// (`?featured=true`, S2.2) so an admin pin renders even when it's older than the
// freshest-24 window. Cached so getFeaturedListing + getCuratedListings share one
// fetch per request window. Degrades gracefully: each fetch contributes only if it
// succeeds, so if the backend `featured` filter lags a deploy the pool is just the
// freshest-24 (today's behaviour) — never throws (the homepage prerenders at build).
async function fetchListings(path: string): Promise<Listing[]> {
  try {
    const res = await medusaFetch(path, {
      next: { revalidate: CACHE.LISTING, tags: ['listings'] },
    } as RequestInit)
    if (!res.ok) return []
    const data = await res.json()
    return data.listings ?? []
  } catch {
    // Network reject / malformed JSON (e.g. backend mid-deploy) → degrade to empty,
    // never throw: the homepage prerenders at build and the pool falls back to whatever
    // the other fetch returned.
    return []
  }
}

const getCuratedPool = unstable_cache(
  async (): Promise<Listing[]> => {
    const [fresh, pinned] = await Promise.all([
      fetchListings('/store/listings?sort=reciente&limit=24'),
      fetchListings('/store/listings?featured=true&limit=50'),
    ])
    return unionById(fresh, pinned)
  },
  ['curated-pool'],
  { revalidate: CACHE.LISTING, tags: ['listings'] },
)

// `now` is injectable so the page can pass ONE timestamp to both featured + grid:
// computing it independently in each could, at the exact 14-day cutoff, let a
// listing be the featured pick in one call yet not be excluded by the other.
/** The Selección featured pick (pinned-first, else freshest qualifying); null when none. */
export async function getFeaturedListing(now = Date.now()): Promise<Listing | null> {
  const pool = await getCuratedPool()
  return pickFeatured(pool, now)
}

/**
 * The Selección grid — every remaining qualifying pin (so the admin's full curation
 * renders, S1.2) plus auto-fill up to GRID_SIZE, capped at GRID_CAP; excludes the
 * featured card. The unpinned remainder is shuffled per ISR window (`windowSeed(now)`,
 * S3.1) so it visibly rotates across revalidations; pinned/admin-ordered items stay fixed.
 */
export async function getCuratedListings(now = Date.now()): Promise<Listing[]> {
  const pool = await getCuratedPool()
  const featured = pickFeatured(pool, now)
  const n = curatedGridSize(pool, now, featured?.id)
  return curateGrid(pool, now, n, featured?.id, windowSeed(now))
}

/**
 * Live category counts for the "Categorías con vida" module — builds on
 * countListings (one cheap total-only call per category), drops empty categories.
 * Cached ~5 min behind the listings tag.
 */
export const getCategoryCounts = unstable_cache(
  async (): Promise<CategoryCount[]> => {
    const totals = await Promise.all(
      CATEGORIES.map(c => countListings({ category: c.key })),
    )
    const counts: Record<string, number> = {}
    CATEGORIES.forEach((c, i) => { counts[c.key] = totals[i] })
    return liveCategoryCounts(counts)
  },
  ['category-counts'],
  { revalidate: CACHE.CATEGORY, tags: ['listings'] },
)

export function formatPrice(listing: Listing): string {
  if (listing.price_cents == null) return 'Precio a consultar'
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: listing.currency ?? 'MXN',
  }).format(listing.price_cents / 100)
}

export function conditionLabel(condition: Listing['condition']): string {
  const map: Record<string, string> = {
    new: 'Nuevo',
    like_new: 'Como nuevo',
    good: 'Buen estado',
    fair: 'Aceptable',
    parts: 'Para piezas',
  }
  return condition ? (map[condition] ?? condition) : ''
}

/** Slim listing shape for the print-builder's curation drawers (US-4 + the print-studio catalog). */
export interface CatalogListingItem {
  id: string
  title: string
  description: string | null
  price: string | null
  image: string | null
  shop: { slug: string; name: string; logo: string | null; description: string | null } | null
}

export function toCatalogItems(listings: Listing[]): CatalogListingItem[] {
  return listings.map((l) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    price: l.price_cents != null ? formatPrice(l) : null,
    image: l.images?.[0]?.url ?? null,
    shop: l.shop ? { slug: l.shop.slug, name: l.shop.name, logo: l.shop.logo_url ?? null, description: l.shop.description ?? null } : null,
  }))
}
