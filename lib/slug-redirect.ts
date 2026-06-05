/**
 * lib/slug-redirect.ts
 *
 * Reverse lookup for retired shop slugs: given a slug that no longer matches a
 * live shop, return the shop's CURRENT slug if the old one is a non-expired alias
 * (within the 90-day window), else null. Feeds the 301 on /s/[slug] (US-4).
 *
 * The alias history lives in `marketplace_shops.metadata`:
 *  - `previous_slugs`: [{ slug, until }]  — source of truth (with expiry)
 *  - `previous_slug_keys`: string[]       — flat list for the containment query
 * Written by PATCH /api/sell/shop/slug. Cached + tagged `shop-slug-aliases`; that
 * route calls `revalidateTag('shop-slug-aliases','default')` so a rename takes
 * effect immediately (mirrors lib/custom-domain.ts).
 */

import { unstable_cache } from 'next/cache'
import { db } from '@/lib/supabase'
import { pickAliasTarget, type PreviousSlug } from '@/lib/slug'

export const SLUG_REDIRECT_TAG = 'shop-slug-aliases'

export const getSlugRedirect = unstable_cache(
  async (slug: string): Promise<string | null> => {
    const s = slug.trim().toLowerCase()
    if (!s) return null
    // Enhancement-only: never let a Supabase hiccup (or a stubbed client in an
    // env without service-role creds) throw and take down the shop page.
    try {
      const { data } = await db
        .from('marketplace_shops')
        .select('slug, metadata')
        .contains('metadata', { previous_slug_keys: [s] })
        .limit(1)
        .maybeSingle()
      if (!data?.slug) return null
      const meta = (data.metadata ?? {}) as Record<string, unknown>
      const prev = (Array.isArray(meta.previous_slugs) ? meta.previous_slugs : []) as PreviousSlug[]
      return pickAliasTarget(String(data.slug), prev, s)
    } catch {
      return null
    }
  },
  ['shop-slug-redirect'],
  { revalidate: 300, tags: [SLUG_REDIRECT_TAG] },
)
