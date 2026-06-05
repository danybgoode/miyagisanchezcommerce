/**
 * lib/custom-domain.ts
 *
 * Reverse lookup for the "own channel": given a shop slug, return its LIVE custom
 * domain (or null). Used on the platform host to redirect legacy marketplace URLs
 * (/s/[slug], /l/[id]) to the tenant's own domain and to emit canonical/OG tags
 * that consolidate SEO onto that domain.
 *
 * A domain only counts as live when it's both set AND verified — `custom_domain`
 * present and `custom_domain_verified = true` (the same flag the seller-facing
 * domain flow flips when our DNS check confirms the domain points at us). This
 * guards against redirecting buyers to a domain that isn't actually serving yet.
 *
 * Cached + tagged `shop-domains`: the domain POST/GET/DELETE handlers call
 * `revalidateTag('shop-domains')` so activation and removal take effect instantly
 * (no stale redirect to a just-disconnected domain).
 */

import { unstable_cache } from 'next/cache'
import { db } from '@/lib/supabase'

export const getActiveCustomDomain = unstable_cache(
  async (slug: string): Promise<string | null> => {
    if (!slug) return null
    // The redirect/canonical this feeds is an ENHANCEMENT — never let a Supabase
    // hiccup (or a stubbed client in an env without service-role creds, e.g. a
    // preview) throw and take down the shop/product page. Degrade to "no domain".
    try {
      const { data } = await db
        .from('marketplace_shops')
        .select('custom_domain, custom_domain_verified')
        .eq('slug', slug)
        .maybeSingle()
      if (!data?.custom_domain || !data.custom_domain_verified) return null
      return String(data.custom_domain).toLowerCase()
    } catch {
      return null
    }
  },
  ['active-custom-domain'],
  { revalidate: 300, tags: ['shop-domains'] },
)

export const SHOP_DOMAINS_TAG = 'shop-domains'

/**
 * Is `domain` a LIVE (verified) custom domain of some shop? The open-redirect
 * guard before sending a buyer back to a tenant domain after checkout — we only
 * ever redirect to a domain that's actually a verified tenant storefront, never
 * to a value forged in order metadata.
 */
export const isVerifiedCustomDomain = unstable_cache(
  async (domain: string): Promise<boolean> => {
    const d = domain.trim().toLowerCase()
    if (!d) return false
    try {
      const { data } = await db
        .from('marketplace_shops')
        .select('id')
        .eq('custom_domain', d)
        .eq('custom_domain_verified', true)
        .maybeSingle()
      return !!data
    } catch {
      return false
    }
  },
  ['is-verified-custom-domain'],
  { revalidate: 300, tags: ['shop-domains'] },
)
