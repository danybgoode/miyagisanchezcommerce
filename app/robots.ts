import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

/**
 * Host-aware robots.txt. On a tenant's custom domain (tagged by middleware) we
 * advertise THAT domain's own sitemap, so crawlers index the independent brand
 * identity instead of treating it as a mirror of the marketplace. On the
 * platform host it points at the marketplace sitemap. Reading headers() makes
 * this per-host dynamic.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  const domain = h.get('x-miyagi-domain')
  const host = (domain ?? h.get('host') ?? 'miyagisanchez.com').split(':')[0]
  const base = `https://${host}`
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${base}/sitemap.xml`,
    host, // bare hostname (the Host directive is a preferred-mirror hint)
  }
}
