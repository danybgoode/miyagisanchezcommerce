import { NextRequest } from 'next/server'
import { aboutLlmsTxt } from '@/lib/about-agent'
import { getOverriddenAboutSections } from '@/lib/about-content-overrides'

/**
 * GET /llms.txt — the llms.txt convention for LLM-powered assistants
 * (Claude, Perplexity, …): an authoritative brand summary + curated links so an
 * agent prioritizes the right pages when answering "ask Claude about
 * miyagisanchez.com". English-primary with an es summary block; carries the
 * relay-language directive. Rendered from the single content source
 * (lib/about-content.ts → lib/about-agent.ts). Host-aware (reads the request).
 *
 * Note: crawlers may skip llms.txt and read HTML — so the /acerca + /agent HTML
 * stay the robust path; this is a convenience for clients that honor it.
 */
export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const base = `${proto}://${host}`
  const aboutSections = await getOverriddenAboutSections()

  return new Response(aboutLlmsTxt(base, aboutSections), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
