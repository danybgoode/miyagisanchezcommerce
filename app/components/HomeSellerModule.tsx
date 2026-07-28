'use client'

import Link from 'next/link'
import { useHomePersonalization } from './HomePersonalizationProvider'
import { sellerModule } from '@/lib/home-personalization'

/**
 * Marketplace static-shell — Sprint 4. The bottom personalization slot: the signed-in
 * seller module — either the "Tu tienda esta semana" snapshot (has a shop) or the
 * "¿Vendes algo?" recruit card (no shop). Markup is verbatim from the pre-S2
 * `app/page.tsx` signed-in block; data comes from the client island fetch.
 *
 * Loading state (2026-07): nothing renders while the session is still resolving or for
 * a signed-out visitor (matches the static markup exactly, no hydration mismatch). Once
 * we know the visitor is signed in, a skeleton reserves this slot's height until the
 * single personalization fetch resolves — this is a one-fetch slot, no second hop like
 * the rail has, so there's no separate "ready" flag needed.
 */
export default function HomeSellerModule() {
  const { data, isLoaded, isSignedIn, settled } = useHomePersonalization()
  if (!isLoaded) return null
  if (!isSignedIn) return null

  // Fetch finished with nothing (failed or blocked — routine off the prod origin): degrade
  // to the pre-skeleton behaviour and render nothing. Only an UNsettled fetch gets a
  // skeleton, or a failure would shimmer here forever.
  if (!data) {
    if (settled) return null
    return (
      <section className="mb-4" style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <div className="card-tile" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
          <div className="skeleton" style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="skeleton" style={{ width: '55%', height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: '75%', height: 12, borderRadius: 4, marginTop: 8 }} />
          </div>
          <div className="skeleton" style={{ flexShrink: 0, width: 96, height: 30, borderRadius: 8 }} />
        </div>
      </section>
    )
  }

  const which = sellerModule({ hasShop: data.hasShop, sellerSnapshot: data.sellerSnapshot })

  // A shop owner with no stats payload yet renders nothing — never the recruit card.
  if (which === 'none') return null

  if (which === 'snapshot' && data.sellerSnapshot) {
    // Defensive: the wire contract sends numbers, but a missing field would otherwise
    // render "undefined visita(s)" — coerce to 0.
    const visitas = data.sellerSnapshot.visitas ?? 0
    const ofertasNuevas = data.sellerSnapshot.ofertasNuevas ?? 0
    return (
      <section
        className="mb-4 fade-in"
        data-testid="home-seller-snapshot"
        style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 20 }}
      >
        <div className="card-tile" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
          <div
            style={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent-soft)',
            }}
          >
            <i className="iconoir-shop" style={{ fontSize: 22, color: 'var(--accent)' }} aria-hidden />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Tu tienda esta semana</p>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2 }}>
              {visitas} visita{visitas === 1 ? '' : 's'} · {ofertasNuevas} oferta{ofertasNuevas === 1 ? '' : 's'} nueva{ofertasNuevas === 1 ? '' : 's'}
            </p>
          </div>
          <Link href="/sell" className="btn btn-primary btn-sm no-underline" style={{ flexShrink: 0 }}>
            Publicar otro
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section
      className="mb-4 fade-in"
      data-testid="home-seller-recruit"
      style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 20 }}
    >
      <div className="card-tile" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>¿Vendes algo?</p>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2 }}>
            Abre tu tienda gratis y empieza a vender en minutos.
          </p>
        </div>
        <Link href="/vende" className="btn btn-primary btn-sm no-underline" style={{ flexShrink: 0 }}>
          Abre tu tienda
        </Link>
      </div>
    </section>
  )
}
