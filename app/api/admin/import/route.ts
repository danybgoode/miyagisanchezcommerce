/**
 * POST /api/admin/import
 *
 * Processes pending rows in marketplace_import_queue and converts them into
 * marketplace_shops + marketplace_listings records.
 *
 * Protected by a shared secret — send header:
 *   Authorization: Bearer <ADMIN_SECRET>
 *
 * Expected raw_data shape (each import queue row):
 * {
 *   shop: { name, slug, description?, location?, logo_url?, source_url? }
 *   listing: {
 *     title, description?, price_cents?, currency?, condition?,
 *     listing_type?, location?, images?, tags?
 *   }
 * }
 *
 * Returns: { processed: number, skipped: number, failed: number }
 */

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const ADMIN_SECRET = process.env.ADMIN_SECRET

export async function POST(req: Request) {
  // Auth check
  if (ADMIN_SECRET) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${ADMIN_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Fetch pending rows (process up to 100 at a time)
  const { data: rows, error: fetchErr } = await db
    .from('marketplace_import_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)

  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 })
  }

  let processed = 0
  let skipped = 0
  let failed = 0

  for (const row of rows ?? []) {
    try {
      const data = row.raw_data as Record<string, unknown>
      const shopData = data.shop as Record<string, unknown> | undefined
      const listingData = data.listing as Record<string, unknown> | undefined

      if (!shopData?.name || !shopData?.slug || !listingData?.title) {
        await db
          .from('marketplace_import_queue')
          .update({ status: 'failed', error: 'raw_data missing shop.name, shop.slug, or listing.title' })
          .eq('id', row.id)
        failed++
        continue
      }

      // 1 — Upsert shop by slug
      const { data: shop, error: shopErr } = await db
        .from('marketplace_shops')
        .upsert(
          {
            slug: shopData.slug,
            name: shopData.name,
            description: shopData.description ?? null,
            location: shopData.location ?? null,
            logo_url: shopData.logo_url ?? null,
            source: row.source_platform,
            source_url: (shopData.source_url as string | null) ?? row.source_url,
            verified: false,
          },
          { onConflict: 'slug', ignoreDuplicates: false },
        )
        .select('id')
        .single()

      if (shopErr || !shop) {
        throw new Error(`Shop upsert: ${shopErr?.message ?? 'no data'}`)
      }

      // 2 — Check for duplicate listing (same source_url)
      const { data: existing } = await db
        .from('marketplace_listings')
        .select('id')
        .eq('source_url', row.source_url)
        .maybeSingle()

      if (existing) {
        await db
          .from('marketplace_import_queue')
          .update({ status: 'duplicate', processed_at: new Date().toISOString() })
          .eq('id', row.id)
        skipped++
        continue
      }

      // 3 — Insert listing
      const { error: listErr } = await db.from('marketplace_listings').insert({
        shop_id: shop.id,
        title: listingData.title,
        description: (listingData.description as string | null) ?? null,
        price_cents: (listingData.price_cents as number | null) ?? null,
        currency: (listingData.currency as string | null) ?? 'USD',
        condition: (listingData.condition as string | null) ?? null,
        listing_type: (listingData.listing_type as string | null) ?? 'product',
        location: (listingData.location as string | null) ?? (shopData.location as string | null) ?? null,
        images: (listingData.images as object[] | null) ?? [],
        tags: (listingData.tags as string[] | null) ?? [],
        status: 'active',
        source: row.source_platform,
        source_url: row.source_url,
        source_platform: row.source_platform,
      })

      if (listErr) throw new Error(`Listing insert: ${listErr.message}`)

      // 4 — Mark queue row processed
      await db
        .from('marketplace_import_queue')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', row.id)

      processed++
    } catch (err) {
      await db
        .from('marketplace_import_queue')
        .update({ status: 'failed', error: (err as Error).message })
        .eq('id', row.id)
      failed++
    }
  }

  return Response.json({ processed, skipped, failed, total: (rows ?? []).length })
}

/**
 * GET /api/admin/import
 * Returns queue stats (count by status).
 */
export async function GET(req: Request) {
  if (ADMIN_SECRET) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${ADMIN_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { data } = await db
    .from('marketplace_import_queue')
    .select('status')

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1
  }

  return Response.json({ counts })
}
