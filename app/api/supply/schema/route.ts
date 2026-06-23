import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withAdmin } from '@/lib/admin/guard'

const CHECKS = [
  {
    table: 'marketplace_shops',
    select: 'id, slug, name, description, location, logo_url, clerk_user_id, verified, source, source_url, metadata, created_at, mp_enabled',
    role: 'Live shop import target',
  },
  {
    table: 'marketplace_listings',
    select: 'id, shop_id, title, description, price_cents, currency, condition, listing_type, category, state, municipio, location, metadata, images, tags, status, source, source_platform, source_url, views, created_at',
    role: 'Live listing import target',
  },
  {
    table: 'supply_batches',
    select: 'id, name, source_platform, source_mode, category, listing_type, state, municipio, location, target_status, acquisition_settings, status, total_count, approved_count, rejected_count, imported_count, duplicate_count, failed_count, error_message, created_at, updated_at, imported_at',
    role: 'Supply acquisition runs',
  },
  {
    table: 'supply_items',
    select: 'id, batch_id, status, quality_score, duplicate_key, source_platform, source_url, source_id, shop_name, shop_slug, shop_source_url, shop_description, shop_location, shop_logo_url, shop_metadata, listing_title, listing_description, price_cents, currency, condition, listing_type, category, state, municipio, location, images, tags, listing_metadata, raw_data, error_message, imported_shop_id, imported_listing_id, created_at, updated_at, imported_at',
    role: 'Reviewed staging rows',
  },
]

export const GET = withAdmin(async () => {
  const results = []
  for (const check of CHECKS) {
    const { error } = await db.from(check.table).select(check.select).limit(1)
    results.push({
      table: check.table,
      role: check.role,
      ok: !error,
      error: error?.message ?? null,
    })
  }

  return NextResponse.json({
    ok: results.every(r => r.ok),
    checks: results,
  })
})
