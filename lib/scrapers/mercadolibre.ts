import { db } from '../supabase'
import type { ScrapeResult } from './serpapi'

export interface MLScrapeParams {
  query: string       // e.g. "laptop"
  category?: string   // miyagisanchez category: 'electronica', 'hogar', etc.
  state?: string      // ML state filter (optional)
  limit?: number      // default 20
}

interface MLSearchItem {
  id: string
  title: string
  price: number
  currency_id: string
  condition: string
  thumbnail: string
  permalink: string
  seller: { id: number; nickname: string }
  address?: { state_name?: string; city_name?: string }
}

interface MLSearchResponse {
  results?: MLSearchItem[]
}

const CONDITION_MAP: Record<string, string> = {
  new: 'new',
  used: 'good',
}

function slugify(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

export async function scrapeMercadoLibre(params: MLScrapeParams): Promise<ScrapeResult> {
  const { query, category, state, limit = 20 } = params

  const url = new URL('https://api.mercadolibre.com/sites/MLM/search')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(Math.min(limit, 50)))

  // ML public search requires an app-level access token since ~2024.
  // Use client_credentials flow if ML_APP_ID + ML_APP_SECRET are set.
  const headers: Record<string, string> = { 'User-Agent': 'miyagisanchez/1.0' }
  if (process.env.ML_APP_ID && process.env.ML_APP_SECRET) {
    const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.ML_APP_ID,
        client_secret: process.env.ML_APP_SECRET,
      }),
    })
    if (tokenRes.ok) {
      const tok = await tokenRes.json()
      if (tok.access_token) headers['Authorization'] = `Bearer ${tok.access_token}`
    }
  }

  const res = await fetch(url.toString(), { headers, next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`ML API HTTP ${res.status} — add ML_APP_ID + ML_APP_SECRET to .env.local`)
  const data = await res.json() as MLSearchResponse
  const items: MLSearchItem[] = data.results ?? []

  let inserted = 0, skipped = 0, errors = 0

  for (const item of items.slice(0, limit)) {
    try {
      const sourceUrl = item.permalink

      // Check if listing already exists
      const { data: existing } = await db
        .from('marketplace_listings')
        .select('id')
        .eq('source_url', sourceUrl)
        .maybeSingle()

      if (existing) { skipped++; continue }

      // Upsert shop by seller id
      const sellerSourceUrl = `https://www.mercadolibre.com.mx/perfil/${item.seller.id}`
      const { data: existingShop } = await db
        .from('marketplace_shops')
        .select('id')
        .eq('source_url', sellerSourceUrl)
        .maybeSingle()

      let shopId: string

      if (existingShop) {
        shopId = existingShop.id
      } else {
        const slug = slugify(item.seller.nickname || `ml-seller-${item.seller.id}`) + '-' + Math.random().toString(36).slice(2, 6)
        const { data: newShop, error: shopErr } = await db
          .from('marketplace_shops')
          .insert({
            slug,
            name: item.seller.nickname || `Vendedor ${item.seller.id}`,
            source: 'scraped',
            source_url: sellerSourceUrl,
            verified: false,
          })
          .select('id')
          .single()

        if (shopErr || !newShop) { errors++; continue }
        shopId = newShop.id
      }

      // Insert listing
      const { error: listErr } = await db
        .from('marketplace_listings')
        .insert({
          shop_id: shopId,
          title: item.title,
          price_cents: Math.round(item.price * 100),
          currency: item.currency_id,
          condition: (CONDITION_MAP[item.condition] ?? 'good') as 'new' | 'like_new' | 'good' | 'fair' | 'parts',
          listing_type: 'product',
          location: item.address?.city_name ?? item.address?.state_name ?? null,
          state: state ?? item.address?.state_name ?? null,
          category: category ?? null,
          source: 'scraped',
          source_platform: 'mercadolibre',
          source_url: sourceUrl,
          images: item.thumbnail ? [{ url: item.thumbnail, alt: item.title }] : [],
          status: 'active',
          metadata: { ml_item_id: item.id },
        })

      if (listErr) { errors++; continue }
      inserted++
    } catch {
      errors++
    }
  }

  return { inserted, skipped, errors }
}
