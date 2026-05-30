import { unstable_cache } from 'next/cache'
import type { Listing, Shop, SearchParams } from './types'

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

// Build query string from SearchParams, forwarding all supported filter keys.
function buildQuery(params: SearchParams & { limit?: number | string }): string {
  const allowed = [
    'q', 'category', 'state', 'municipio', 'condition', 'min_price', 'max_price',
    'location', 'sort', 'page', 'limit',
    'brand', 'year_from', 'year_to', 'km_from', 'km_to', 'transmission', 'fuel',
    'rooms_min', 'rooms_max', 'surface_min', 'surface_max', 'property_type',
  ]
  const sp = new URLSearchParams()
  for (const key of allowed) {
    const val = (params as Record<string, string | number | undefined>)[key]
    if (val != null && val !== '') sp.set(key, String(val))
  }
  return sp.toString() ? `?${sp.toString()}` : ''
}

export async function searchListings(
  params: SearchParams,
): Promise<{ listings: Listing[]; total: number; page: number }> {
  const page = Math.max(1, parseInt(params.page ?? '1'))
  const qs = buildQuery({ ...params, page: String(page), limit: 24 })

  const res = await medusaFetch(`/store/listings${qs}`, {
    next: { revalidate: 30, tags: ['listings'] },
  } as RequestInit)

  if (!res.ok) {
    console.error('[listings] searchListings failed', res.status, await res.text())
    return { listings: [], total: 0, page }
  }

  const data = await res.json()
  return { listings: data.listings ?? [], total: data.total ?? 0, page: data.page ?? page }
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
  { revalidate: 60, tags: ['listings'] },
)

export const getShop = unstable_cache(
  async (slug: string): Promise<Shop | null> => {
    const res = await medusaFetch(`/store/sellers/${slug}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.seller ?? null
  },
  ['shop'],
  { revalidate: 120, tags: ['shops'] },
)

export const getShopListings = unstable_cache(
  async (sellerSlug: string): Promise<Listing[]> => {
    const res = await medusaFetch(`/store/sellers/${sellerSlug}/products`, {
      next: { revalidate: 60, tags: ['listings'] },
    } as RequestInit)
    if (!res.ok) return []
    const data = await res.json()

    // Map seller products to Listing shape
    const seller = data.seller
    return (data.products ?? []).map((p: any) => {
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
  { revalidate: 60, tags: ['listings'] },
)

export async function getRecentListings(limit = 8): Promise<Listing[]> {
  const res = await medusaFetch(`/store/listings?sort=reciente&limit=${limit}`, {
    next: { revalidate: 60, tags: ['listings'] },
  } as RequestInit)
  if (!res.ok) return []
  const data = await res.json()
  return data.listings ?? []
}

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
