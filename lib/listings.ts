import { db } from './supabase'
import type { Listing, Shop, SearchParams } from './types'

const PAGE_SIZE = 24

export async function searchListings(params: SearchParams): Promise<{ listings: Listing[]; total: number; page: number }> {
  const page = Math.max(1, parseInt(params.page ?? '1'))
  const offset = (page - 1) * PAGE_SIZE

  let query = db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location)', { count: 'exact' })
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (params.q) {
    query = query.textSearch('title', params.q, { type: 'websearch', config: 'spanish' })
  }
  if (params.type) query = query.eq('listing_type', params.type)
  if (params.condition) query = query.eq('condition', params.condition)
  if (params.min_price) query = query.gte('price_cents', parseInt(params.min_price) * 100)
  if (params.max_price) query = query.lte('price_cents', parseInt(params.max_price) * 100)
  if (params.location) query = query.ilike('location', `%${params.location}%`)

  const { data, count, error } = await query
  if (error) throw new Error(error.message)
  return { listings: (data ?? []) as Listing[], total: count ?? 0, page }
}

export async function getListing(id: string): Promise<Listing | null> {
  const { data } = await db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,description,logo_url,clerk_user_id)')
    .eq('id', id)
    .eq('status', 'active')
    .single()

  if (data) {
    // increment view count fire-and-forget
    db.from('marketplace_listings').update({ views: (data.views ?? 0) + 1 }).eq('id', id)
  }
  return data as Listing | null
}

export async function getShop(slug: string): Promise<Shop | null> {
  const { data } = await db
    .from('marketplace_shops')
    .select('*')
    .eq('slug', slug)
    .single()
  return data as Shop | null
}

export async function getShopListings(shopId: string): Promise<Listing[]> {
  const { data } = await db
    .from('marketplace_listings')
    .select('*')
    .eq('shop_id', shopId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  return (data ?? []) as Listing[]
}

export async function getRecentListings(limit = 8): Promise<Listing[]> {
  const { data } = await db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as Listing[]
}

export function formatPrice(listing: Listing): string {
  if (listing.price_cents == null) return 'Precio a consultar'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: listing.currency ?? 'USD' })
    .format(listing.price_cents / 100)
}

export function conditionLabel(condition: Listing['condition']): string {
  const map: Record<string, string> = {
    new: 'Nuevo', like_new: 'Como nuevo', good: 'Buen estado', fair: 'Aceptable', parts: 'Para piezas',
  }
  return condition ? (map[condition] ?? condition) : ''
}
