'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { pushAnalyticsEvent } from '@/lib/analytics-events'
import { parseSellerAcquisitionUtm } from '@/lib/seller-acquisition'

/**
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.4) —
 * the homepage teaser linking `/comparador`. A CLIENT island (like `AuthShow` /
 * `HomeRetomaOffers`) so the static `/` page's own server render stays untouched —
 * this component renders a plain `href="/comparador"` on the server pass, then
 * upgrades the href client-side to forward any UTM params present on `/` itself
 * (a visitor who landed on `/` via a campaign link keeps that attribution through
 * to the comparator) — same UTM-forwarding shape `lib/seller-acquisition.ts`
 * already uses for the `/vende` persona router. Fires a deduped view impression +
 * a click event via `lib/analytics-events.ts`, mirroring the `/vende` Clarity/UTM
 * rig (`SellerAcquisitionVariantTag` + `pushAnalyticsEvent`).
 */
export default function ComparadorTeaserCard() {
  const [href, setHref] = useState('/comparador')

  useEffect(() => {
    const utm = parseSellerAcquisitionUtm(window.location.search)
    const params = new URLSearchParams(utm)
    const qs = params.toString()
    setHref(qs ? `/comparador?${qs}` : '/comparador')
    pushAnalyticsEvent('comparador_teaser_view', { ...utm }, { dedupeKey: 'comparador_teaser_view' })
  }, [])

  return (
    <Link
      href={href}
      prefetch={false}
      data-testid="home-comparador-teaser"
      className="card-tile no-underline block mb-6"
      onClick={() => pushAnalyticsEvent('comparador_teaser_click')}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 44,
          height: 44,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-sunk)',
        }}
      >
        <i className="iconoir-stats-report" style={{ fontSize: 24, color: 'var(--accent)' }} aria-hidden />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
          Comparador de costos
        </p>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>
          ¿Cuánto pagas hoy vs. Miyagi?
        </p>
        <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          Compara Shopify, Mercado Libre, WooCommerce o Tiendanube con tus propios números.
        </p>
      </div>
      <span style={{ flexShrink: 0, fontSize: 13, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
        Comparar →
      </span>
    </Link>
  )
}
