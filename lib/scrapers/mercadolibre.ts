import { db } from '../supabase'
import type { ScrapeResult } from './serpapi'

export interface MLScrapeParams {
  query: string       // e.g. "laptop"
  category?: string   // miyagisanchez category: 'electronica', 'hogar', etc.
  state?: string      // ML state filter (optional)
  limit?: number      // default 20
  clerkUserId?: string // if provided, use connected ML account token
}

export interface MLSellerScrapeParams {
  sellerUrl: string   // ML listing URL or seller profile URL
  category?: string
  limit?: number
  clerkUserId?: string
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
  descriptions?: { plain_text?: string }[]
  attributes?: { id: string; value_name: string | null }[]
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

/** Quality score 0–5. Min 3 required for insertion. */
function qualityScore(item: MLSearchItem): number {
  let score = 0
  if (item.thumbnail) score++
  if (item.title && item.title.length >= 10) score++
  if (item.price > 0) score++
  if (item.address?.city_name || item.address?.state_name) score++
  // Bonus: condition is explicitly set (not blank)
  if (item.condition) score++
  return score
}

/** Get an ML access token for scraping. Priority:
 *  1. Connected Clerk user's token (from commerce_ml_connections)
 *  2. App-level client credentials (ML_APP_ID + ML_APP_SECRET)
 *  Returns { token, diag }
 */
async function resolveToken(clerkUserId?: string): Promise<{ token: string | null; diag: string }> {
  // 1. Try connected user's token
  if (clerkUserId) {
    try {
      const { data } = await db
        .from('commerce_ml_connections')
        .select('access_token, refresh_token, expires_at, ml_user_id, clerk_user_id')
        .eq('clerk_user_id', clerkUserId)
        .eq('is_active', true)
        .maybeSingle()

      if (data) {
        // Import decrypt lazily (same package, just to avoid circular deps)
        const { decrypt, encrypt } = await import('../encryption')
        const expiresAt = new Date(data.expires_at)
        let accessToken: string

        if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
          // Token expired or expiring soon — refresh it
          const decryptedRefresh = decrypt(data.refresh_token)
          const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: process.env.ML_APP_ID!,
              client_secret: process.env.ML_APP_SECRET!,
              refresh_token: decryptedRefresh,
            }),
          })
          const tok = await tokenRes.json()
          if (!tokenRes.ok) throw new Error(`Token refresh failed (${tokenRes.status}): ${JSON.stringify(tok)}`)

          // Persist refreshed tokens back to DB
          await db.from('commerce_ml_connections')
            .update({
              access_token: encrypt(tok.access_token),
              refresh_token: encrypt(tok.refresh_token),
              expires_at: new Date(Date.now() + (tok.expires_in ?? 21600) * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('clerk_user_id', clerkUserId)
            .eq('ml_user_id', data.ml_user_id)

          accessToken = tok.access_token
        } else {
          accessToken = decrypt(data.access_token)
        }

        return { token: accessToken, diag: `connected user token (${clerkUserId})` }
      }
    } catch (err) {
      // Fall through to client credentials
      console.warn('[ML scraper] Failed to get user token, falling back:', err)
    }
  }

  // 2. Client credentials fallback
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
    const tok = await tokenRes.json().catch(() => ({}))
    if (tokenRes.ok && tok.access_token) {
      return { token: tok.access_token, diag: 'client_credentials' }
    }
    // Fallback: app_id param (older ML pattern)
    return { token: null, diag: `client_credentials failed (${tokenRes.status}) — will use app_id param` }
  }

  return { token: null, diag: 'no ML_APP_ID/ML_APP_SECRET set' }
}

async function buildRequestHeaders(token: string | null, url: URL, appId?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'User-Agent': 'miyagisanchez/1.0' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
    url.searchParams.set('access_token', token)
  } else if (appId) {
    url.searchParams.set('app_id', appId)
  }
  return headers
}

async function upsertShopAndListing(
  item: MLSearchItem,
  category: string | undefined,
  state: string | undefined,
): Promise<'inserted' | 'skipped' | 'error'> {
  try {
    const sourceUrl = item.permalink

    // Check if listing already exists
    const { data: existing } = await db
      .from('marketplace_listings')
      .select('id')
      .eq('source_url', sourceUrl)
      .maybeSingle()

    if (existing) return 'skipped'

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

      if (shopErr || !newShop) return 'error'
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

    if (listErr) return 'error'
    return 'inserted'
  } catch {
    return 'error'
  }
}

export async function scrapeMercadoLibre(params: MLScrapeParams): Promise<ScrapeResult> {
  const { query, category, state, limit = 20, clerkUserId } = params

  const { token, diag: tokenDiag } = await resolveToken(clerkUserId)

  const url = new URL('https://api.mercadolibre.com/sites/MLM/search')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(Math.min(limit, 50)))

  const headers = await buildRequestHeaders(token, url, process.env.ML_APP_ID)

  const res = await fetch(url.toString(), { headers, next: { revalidate: 0 } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 403) {
      throw new Error(
        `ML API 403 Forbidden. ` +
        `Token: ${tokenDiag}. ` +
        `Fix: go to developers.mercadolibre.com → My Apps → your app → ` +
        `"API products" tab → enable "Items and searches". ` +
        `Raw: ${JSON.stringify(body)}`
      )
    }
    throw new Error(`ML API HTTP ${res.status} (token: ${tokenDiag}) — ${JSON.stringify(body)}`)
  }

  const data = await res.json() as MLSearchResponse
  const items: MLSearchItem[] = data.results ?? []

  let inserted = 0, skipped = 0, errors = 0, filtered = 0

  for (const item of items.slice(0, limit)) {
    const score = qualityScore(item)
    if (score < 3) { filtered++; skipped++; continue }

    const outcome = await upsertShopAndListing(item, category, state)
    if (outcome === 'inserted') inserted++
    else if (outcome === 'skipped') skipped++
    else errors++
  }

  return { inserted, skipped, errors }
}

/** Scrape all active listings from a specific ML seller.
 *  sellerUrl can be:
 *  - A listing URL: https://articulo.mercadolibre.com.mx/MLM-XXXXXX-...
 *  - A seller profile: https://www.mercadolibre.com.mx/perfil/SELLER_ID
 *  - An item ID directly: MLM-123456789
 */
export async function scrapeMLSeller(params: MLSellerScrapeParams): Promise<ScrapeResult & { sellerNickname?: string }> {
  const { sellerUrl, category, limit = 50, clerkUserId } = params

  const { token, diag: tokenDiag } = await resolveToken(clerkUserId)

  if (!token) {
    throw new Error(`No ML token available (${tokenDiag}). Connect your MercadoLibre account first.`)
  }

  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'miyagisanchez/1.0',
  }

  // Resolve seller ID from URL
  // Supported URL formats:
  //   https://www.mercadolibre.com.mx/pagina/automotrizgtrcoyoacn#...&item_id=MLM2938280165
  //   https://articulo.mercadolibre.com.mx/MLM-2938280165-...
  //   https://www.mercadolibre.com.mx/perfil/12345  (numeric ID)
  //   MLM2938280165  (bare item ID)
  let sellerId: number | null = null
  let sellerNickname = ''

  // Extract MLM item ID from URL (including fragment after #)
  const mlmMatch = sellerUrl.match(/MLM[-_]?(\d+)/i)
  // Numeric perfil ID: /perfil/12345
  const profileNumMatch = sellerUrl.match(/\/perfil\/(\d+)(?:[^a-zA-Z]|$)/)
  // Nickname from /pagina/NICKNAME or /perfil/NICKNAME
  const nicknameMatch = sellerUrl.match(/\/(?:pagina|perfil)\/([A-Za-z0-9_-]+)/i)

  if (mlmMatch) {
    // Item URL — use /items/{id} to get seller_id
    // NOTE: requires "Items and searches" enabled in ML developer app.
    // If this returns 403, enable it at: developers.mercadolibre.com → My Apps → API products
    const itemId = `MLM${mlmMatch[1]}`
    const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers: authHeaders })
    if (!itemRes.ok) {
      const body = await itemRes.json().catch(() => ({}))
      if (itemRes.status === 403) {
        throw new Error(
          `ML /items/${itemId} returned 403. ` +
          `You need to enable "Items and searches" in your ML developer app: ` +
          `developers.mercadolibre.com → My Apps → your app → API products tab → enable "Items and searches". ` +
          `Raw: ${JSON.stringify(body)}`
        )
      }
      throw new Error(`ML item fetch failed (${itemRes.status}) for ${itemId}: ${JSON.stringify(body)}`)
    }
    const item = await itemRes.json()
    sellerId = item.seller_id
    sellerNickname = item.seller?.nickname ?? ''
  } else if (profileNumMatch) {
    sellerId = parseInt(profileNumMatch[1])
  } else if (nicknameMatch) {
    const nickname = nicknameMatch[1]
    // Resolve nickname → seller ID via seller's public items
    // GET /users/search is restricted; use search with nickname param instead
    const nickRes = await fetch(
      `https://api.mercadolibre.com/sites/MLM/search?nickname=${encodeURIComponent(nickname)}&limit=1`,
      { headers: authHeaders }
    )
    if (nickRes.ok) {
      const nickData = await nickRes.json()
      sellerId = nickData.seller?.id ?? null
      sellerNickname = nickname
    } else {
      throw new Error(
        `Could not look up seller "${nickname}" — ML returned ${nickRes.status}. ` +
        `Try using a direct listing URL or numeric seller ID instead.`
      )
    }
  }

  if (!sellerId) {
    throw new Error(
      `Could not resolve seller from URL: "${sellerUrl}". ` +
      `Supported formats:\n` +
      `• Any ML listing URL (contains MLM-XXXXXX or MLM2938280165)\n` +
      `• Seller profile: mercadolibre.com.mx/perfil/12345678\n` +
      `• Seller page: mercadolibre.com.mx/pagina/SELLER_NICKNAME\n` +
      `Tip: paste the full URL including the # fragment — the item_id in the fragment is used.`
    )
  }

  // Fetch seller info
  const sellerRes = await fetch(`https://api.mercadolibre.com/users/${sellerId}`, { headers: authHeaders })
  if (sellerRes.ok) {
    const sellerData = await sellerRes.json()
    sellerNickname = sellerData.nickname ?? ''
  }

  // Fetch seller's active listings
  const searchUrl = new URL(`https://api.mercadolibre.com/users/${sellerId}/items/search`)
  searchUrl.searchParams.set('status', 'active')
  searchUrl.searchParams.set('limit', String(Math.min(limit, 100)))

  const searchRes = await fetch(searchUrl.toString(), { headers: authHeaders })
  if (!searchRes.ok) {
    const body = await searchRes.json().catch(() => ({}))
    throw new Error(`ML seller items search failed (${searchRes.status}): ${JSON.stringify(body)}`)
  }

  const searchData = await searchRes.json()
  const itemIds: string[] = searchData.results ?? []

  if (itemIds.length === 0) {
    return { inserted: 0, skipped: 0, errors: 0, sellerNickname }
  }

  // Fetch item details in batches of 20
  let inserted = 0, skipped = 0, errors = 0

  const batchSize = 20
  for (let i = 0; i < itemIds.length; i += batchSize) {
    const batch = itemIds.slice(i, i + batchSize)
    const detailRes = await fetch(
      `https://api.mercadolibre.com/items?ids=${batch.join(',')}`,
      { headers: authHeaders }
    )
    if (!detailRes.ok) { errors += batch.length; continue }

    const details = await detailRes.json() as Array<{ code: number; body: MLSearchItem }>
    for (const entry of details) {
      if (entry.code !== 200) { errors++; continue }
      const item = entry.body

      const score = qualityScore(item)
      if (score < 3) { skipped++; continue }

      const outcome = await upsertShopAndListing(item, category, undefined)
      if (outcome === 'inserted') inserted++
      else if (outcome === 'skipped') skipped++
      else errors++
    }
  }

  return { inserted, skipped, errors, sellerNickname }
}
