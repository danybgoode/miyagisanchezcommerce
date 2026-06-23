'use client'

import Link from 'next/link'
import { useHomePersonalization } from './HomePersonalizationProvider'
import { sellerModule } from '@/lib/home-personalization'

/**
 * Marketplace static-shell — Sprint 4. The bottom personalization slot: the signed-in
 * seller module — either the "Tu tienda esta semana" snapshot (has a shop) or the
 * "¿Vendes algo?" recruit card (no shop). Markup is verbatim from the pre-S2
 * `app/page.tsx` signed-in block; data comes from the client island fetch. Renders
 * nothing until data lands (signed-out/loading visitors see the plain static page).
 */
export default function HomeSellerModule() {
  const data = useHomePersonalization()
  if (!data) return null

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
        className="mb-4"
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
      className="mb-4"
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
