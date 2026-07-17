'use client'

import { useEffect } from 'react'
import { pushAnalyticsEvent } from '@/lib/analytics-events'
import { parseSellerAcquisitionUtm } from '@/lib/seller-acquisition'

declare global {
  interface Window {
    clarity?: (command: 'set', key: string, value: string) => void
  }
}

/**
 * Comparador de costos (epic 08, Sprint 1 · US-1.4) — Clarity tag + a single
 * "view" analytics event, same rig as `/vende`'s
 * `SellerAcquisitionVariantTag` (`window.clarity('set', …)`) +
 * `pushAnalyticsEvent` (`lib/analytics-events.ts`). Reads whatever UTM params
 * are present on THIS page's own URL (the same `parseSellerAcquisitionUtm`
 * the seller-acquisition pages use) — the homepage teaser forwards its own
 * incoming UTM onto the `/comparador` link, so a visitor who arrived via a
 * campaign link on `/` keeps that attribution here.
 *
 * `comparador_calculated` (the Grower success signal from the epic README —
 * "comparisons run") fires separately from `ComparadorTool` on first
 * interaction, deduped per browser.
 */
export default function ComparadorAnalytics() {
  useEffect(() => {
    const utm = parseSellerAcquisitionUtm(window.location.search)
    window.clarity?.('set', 'comparador_utm_source', utm.utm_source ?? 'direct')
    pushAnalyticsEvent('comparador_view', { ...utm }, { dedupeKey: 'comparador_view' })
  }, [])

  return null
}
