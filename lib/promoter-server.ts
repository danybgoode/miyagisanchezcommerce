/**
 * Promoter Program — Sprint 4 server-side resolvers (Supabase reads that can't be
 * pure). Kept apart from the pure lib/promoter-close.ts so the unit tests stay
 * next/supabase-free; this module is imported only by the authed close routes.
 */
import 'server-only'
import { db } from '@/lib/supabase'

export interface TargetShop {
  /** marketplace_shops.id (the mirror UUID) — the attribution + grant key. */
  id: string
  slug: string
  name: string
  /** null for an unclaimed shop (the common promoter case). */
  clerkUserId: string | null
  /** The Medusa seller id (sel_…) from metadata — the claim token addresses this. */
  medusaSellerId: string | null
  /** Raw shop metadata JSONB — lets a caller read an existing entitlement grant
   *  (e.g. `subdomain_grant`/`custom_domain_grant`) before writing a new one. */
  metadata: Record<string, unknown>
}

/**
 * Resolve the merchant shop a promoter is acting on, by mirror id or slug. A
 * promoter pays / hands off on a shop they did NOT create a Clerk session for, so
 * this never filters by clerk_user_id (unlike the seller-self routes). Returns
 * null when nothing matches.
 */
export async function resolveTargetShop(selector: { shopId?: string | null; slug?: string | null }): Promise<TargetShop | null> {
  const shopId = (selector.shopId ?? '').trim()
  const slug = (selector.slug ?? '').trim()
  if (!shopId && !slug) return null

  const query = db.from('marketplace_shops').select('id, slug, name, clerk_user_id, metadata')
  const { data } = shopId
    ? await query.eq('id', shopId).maybeSingle()
    : await query.eq('slug', slug).maybeSingle()
  if (!data) return null

  const meta = (data.metadata ?? {}) as Record<string, unknown>
  return {
    id: data.id as string,
    slug: data.slug as string,
    name: (data.name as string) ?? '',
    clerkUserId: (data.clerk_user_id as string | null) ?? null,
    medusaSellerId: typeof meta.medusa_seller_id === 'string' ? meta.medusa_seller_id : null,
    metadata: meta,
  }
}
