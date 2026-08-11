/**
 * Pure platform sitemap population. Kept outside app/sitemap.ts so the market
 * cutover can prove canonical population without importing Next's request-only
 * headers module into the deterministic API test project.
 */
export const PLATFORM_SITEMAP_ENTRIES = [
  { path: '/', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/mx', changeFrequency: 'daily', priority: 1 },
  { path: '/mx/l', changeFrequency: 'daily', priority: 0.9 },
  { path: '/us', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/us/l', changeFrequency: 'daily', priority: 0.9 },
  { path: '/acerca', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/vende', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/vende/creadores', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vende/mundial', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vende/negocios', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vende/servicios', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vende/autos', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vende/migracion', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vende/migracion/shopify', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/vende/migracion/tiendanube', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/vende/migracion/woocommerce', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/vende/migracion/bigcartel', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/sell', changeFrequency: 'monthly', priority: 0.5 },
] as const

export function platformSitemapUrls(origin = 'https://miyagisanchez.com'): string[] {
  const base = origin.replace(/\/+$/, '')
  return PLATFORM_SITEMAP_ENTRIES.map(({ path }) => `${base}${path}`)
}
