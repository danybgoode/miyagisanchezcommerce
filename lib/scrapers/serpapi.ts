import { db } from '../supabase'

export interface SerpApiScrapeParams {
  query: string       // e.g. "taller mecánico"
  location: string    // e.g. "Ciudad de México, Mexico"
  state: string       // for DB field: e.g. "Ciudad de México"
  category?: string   // defaults to 'servicios'
  limit?: number      // default 20
}

export interface ScrapeResult {
  inserted: number
  skipped: number
  errors: number
}

interface SerpLocalResult {
  position: number
  title: string
  place_id?: string
  address?: string
  phone?: string
  rating?: number
  reviews?: number
  type?: string
  thumbnail?: string
  website?: string
  gps_coordinates?: { latitude: number; longitude: number }
}

function slugify(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

/** Quality score 0–4 for a Google Local result. Min 2 required for insertion. */
function qualityScore(r: SerpLocalResult): number {
  let score = 0
  if (r.title && r.title.length >= 5) score++           // has a real name
  if (r.address) score++                                 // has an address
  if (r.phone || r.website) score++                     // has contact info
  if (r.thumbnail) score++                               // has photo
  return score
}

export async function scrapeSerpApiLocal(params: SerpApiScrapeParams): Promise<ScrapeResult> {
  const { query, location, state, category = 'servicios', limit = 20 } = params

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_local')
  url.searchParams.set('q', query)
  url.searchParams.set('location', location)
  url.searchParams.set('hl', 'es')
  url.searchParams.set('gl', 'mx')
  url.searchParams.set('api_key', process.env.SERPAPI_KEY!)

  const res = await fetch(url.toString(), { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`)
  const data = await res.json() as {
    error?: string
    local_results?: SerpLocalResult[]
  }

  if (data.error) throw new Error(`SerpAPI error: ${data.error}`)
  const results: SerpLocalResult[] = (data.local_results ?? []).slice(0, limit)

  let inserted = 0, skipped = 0, errors = 0

  for (const r of results) {
    try {
      // Quality gate — min score 2 to insert
      if (qualityScore(r) < 2) { skipped++; continue }

      const sourceUrl = r.place_id
        ? `https://maps.google.com/?cid=${r.place_id}`
        : `serpapi://local/${encodeURIComponent(r.title + '|' + (r.address ?? location))}`

      // Check if already in DB (by source_url on shop)
      const { data: existing } = await db
        .from('marketplace_shops')
        .select('id')
        .eq('source_url', sourceUrl)
        .maybeSingle()

      if (existing) { skipped++; continue }

      // Build shop metadata — phone + website stored here for PDP contact block
      const shopMetadata: Record<string, unknown> = {}
      if (r.phone) shopMetadata.phone = r.phone
      if (r.website) shopMetadata.website = r.website
      if (r.rating) shopMetadata.rating = r.rating
      if (r.reviews) shopMetadata.reviews = r.reviews

      // Create shop — now includes metadata with contact info
      const slug = slugify(r.title) + '-' + Math.random().toString(36).slice(2, 6)
      const { data: shop, error: shopErr } = await db
        .from('marketplace_shops')
        .insert({
          slug,
          name: r.title,
          location: r.address ?? location,
          source: 'scraped',
          source_url: sourceUrl,
          verified: false,
          metadata: shopMetadata,
        })
        .select('id')
        .single()

      if (shopErr || !shop) { errors++; continue }

      // Create listing
      const { error: listErr } = await db
        .from('marketplace_listings')
        .insert({
          shop_id: shop.id,
          title: r.title,
          description: [r.type, r.address].filter(Boolean).join(' — '),
          listing_type: 'service',
          location: r.address ?? location,
          state,
          category,
          source: 'scraped',
          source_platform: 'google_local',
          source_url: sourceUrl,
          images: r.thumbnail ? [{ url: r.thumbnail, alt: r.title }] : [],
          status: 'active',
          metadata: {
            phone: r.phone ?? null,
            rating: r.rating ?? null,
            reviews: r.reviews ?? null,
            business_type: r.type ?? null,
            lat: r.gps_coordinates?.latitude ?? null,
            lng: r.gps_coordinates?.longitude ?? null,
            place_id: r.place_id ?? null,
            query,
          },
        })

      if (listErr) { errors++; continue }
      inserted++
    } catch {
      errors++
    }
  }

  return { inserted, skipped, errors }
}
