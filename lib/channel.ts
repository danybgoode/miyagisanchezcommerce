/**
 * lib/channel.ts
 *
 * Channel detection for federated commerce.
 * Tags each transaction with its source channel so sellers can see
 * where their sales are coming from (marketplace vs. own domain vs. embed).
 *
 * Used in checkout API routes to enrich Stripe / MP metadata.
 */

import type { NextRequest } from 'next/server'

export type ChannelSource = 'marketplace' | 'custom_domain' | 'embed' | 'api'

const PLATFORM_HOSTS = [
  'miyagisanchez.com',
  'www.miyagisanchez.com',
  'localhost',
  '127.0.0.1',
]

/**
 * Detect the commerce channel from an incoming API request.
 *
 * Logic (first match wins):
 * - X-Miyagi-Channel header: `custom` → custom_domain, `embed` → embed
 *   (set by middleware on custom domains; can't be set on a popup navigation)
 * - `?channel=embed` query param or `mi_channel=embed` cookie → embed
 *   (the embeddable widget hands off to the hosted checkout via window.open(),
 *   which can't carry a header — so the widget marks the URL, and middleware
 *   persists it to a cookie so the channel survives the multi-step checkout)
 * - Origin / Referer is miyagisanchez.com → marketplace
 * - Otherwise (direct API call / UCP) → api
 */
export function detectChannel(req: NextRequest): ChannelSource {
  // Set by middleware when the request arrives via a tenant's custom domain
  const channelHeader = req.headers.get('x-miyagi-channel')
  if (channelHeader === 'custom') return 'custom_domain'
  if (channelHeader === 'embed') return 'embed'

  // Embed widget marks its hosted-checkout hand-off with a query param; the
  // cookie carries it across the subsequent checkout steps.
  if (req.nextUrl?.searchParams.get('channel') === 'embed') return 'embed'
  if (req.cookies?.get('mi_channel')?.value === 'embed') return 'embed'

  // Fall back to Origin / Referer check for browser-initiated requests
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (origin) {
    try {
      const host = new URL(origin).hostname
      if (PLATFORM_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
        return 'marketplace'
      }
      if (host.endsWith('.vercel.app')) return 'marketplace'
      return 'custom_domain'
    } catch { /* malformed URL — fall through */ }
  }

  return 'api'
}
