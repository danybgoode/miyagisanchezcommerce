'use client'

import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import { useSyncExternalStore } from 'react'
import { recommendedMarketForLocale } from '@/lib/market-recommendation'
import type { MarketCode } from '@/lib/markets'

/**
 * "Sugerido por tu navegador" hint on the market selector.
 *
 * RECOMMENDS, NEVER REDIRECTS — Story 2.1's acceptance criterion, and the reason
 * this is a render-nothing-on-the-server client island rather than anything on
 * the request path. A browser language (or an IP guess) is a decent hint and a
 * terrible decision: a Mexican buyer on an en-US laptop, a US operator on a
 * borrowed machine, and every crawler on earth would all be sent somewhere they
 * did not ask to go — permanently, if the redirect were the 308 the rest of this
 * cutover uses. So the hint is a badge beside a choice the visitor still makes.
 *
 * Being a client island also keeps `/` a statically prerendered CDN asset: the
 * server render reads no headers and emits nothing, and the badge appears after
 * hydration. That static/ISR split is load-bearing — it killed a ~30 s cold
 * start (`Roadmap/LEARNINGS.md`, marketplace-static-shell).
 */
export default function MarketRecommendation({ market }: { market: MarketCode }) {
  const recommended = useSyncExternalStore(
    // The browser locale has no change event. This hook is intentionally a
    // read-only hydration bridge: `null` on the static server render, then the
    // actual browser recommendation after React attaches.
    () => () => {},
    () => recommendedMarketForLocale(navigator.language),
    () => null,
  )

  if (recommended !== market) return null
  return (
    <span
      className="badge badge-soft"
      data-testid={`market-suggested-${market}`}
      style={{ fontSize: 11, marginLeft: 8 }}
    >
      <BuyerCopyText copyKey="MarketRecommendation.95e68536" /></span>
  )
}
