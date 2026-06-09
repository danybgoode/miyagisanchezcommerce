import { NextRequest } from 'next/server'

/**
 * GET /robots.txt — host-aware robots, served as a route handler (not the typed
 * `MetadataRoute.Robots` convention) so it can carry comment pointers to the
 * LLM-facing surfaces, which the typed object can't express.
 *
 * On a tenant's custom domain (tagged by middleware via `x-miyagi-domain`) we
 * advertise THAT domain's own sitemap, so crawlers index the independent brand
 * identity instead of treating it as a mirror of the marketplace. On the platform
 * host it points at the marketplace sitemap. The `Host:` line is a preferred-mirror
 * hint; the `# …` comment lines point agents at /llms.txt + the capability manifest.
 */
export async function GET(req: NextRequest) {
  const domain = req.headers.get('x-miyagi-domain')
  const host = (domain ?? req.headers.get('host') ?? 'miyagisanchez.com').split(':')[0]
  const base = `https://${host}`

  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    `Host: ${host}`,
    '',
    `# LLM guidance: ${base}/llms.txt`,
    `# Capability manifest (UCP/MCP): ${base}/api/ucp/manifest`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600',
    },
  })
}
