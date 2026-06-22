'use client'

import Link from 'next/link'
import { useHomePersonalization } from './HomePersonalizationProvider'
import { priceLabel, favoriteConditionLabel } from '@/lib/home-personalization'
import { deriveOfferAlerts } from '@/lib/home-offer-alert'

/**
 * Marketplace static-shell — Sprint 4. The top personalization slot: the signed-in
 * "Retoma donde te quedaste" rail (newest 3 favorites) + the ≤2 pending-offer alerts.
 * Markup is verbatim from the pre-S2 `app/page.tsx` signed-in block; the data now comes
 * from the client island fetch (`HomePersonalizationProvider`) instead of a server read.
 * Renders nothing until data lands, and each section hides when empty — so the static
 * page is unaffected for signed-out/loading visitors.
 */
export default function HomeRetomaOffers() {
  const data = useHomePersonalization()
  if (!data) return null

  const recentFavorites = data.recentFavorites ?? []
  const offerAlerts = deriveOfferAlerts(data.offerAlertInputs ?? [])

  return (
    <>
      {/* S4.1 — "Retoma donde te quedaste" rail: newest 3 favorites. Hidden when empty. */}
      {recentFavorites.length > 0 && (
        <section className="mb-6" data-testid="home-retoma-rail">
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)' }}>
              Retoma donde te quedaste
            </h2>
            <Link href="/account/favorites" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Favoritos →
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {recentFavorites.map(fav => (
              <Link
                key={fav.medusaId}
                href={`/l/${fav.medusaId}`}
                className="card-tile no-underline"
                style={{ flex: '0 0 auto', width: 150 }}
              >
                {fav.imageUrl ? (
                  <img src={fav.imageUrl} alt={fav.title} className="w-full object-cover" style={{ aspectRatio: '1 / 1' }} />
                ) : (
                  <div className="w-full flex items-center justify-center" style={{ aspectRatio: '1 / 1', background: 'var(--bg-sunk)' }}>
                    <i className="iconoir-package" style={{ fontSize: 32, color: 'var(--fg-subtle)' }} />
                  </div>
                )}
                <div className="p-2">
                  <p className="t-price" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>
                    {priceLabel(fav.priceCents, fav.currency)}
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '3px 0 0' }}>
                    {fav.title}
                  </p>
                  {(fav.location || fav.condition) && (
                    <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {[fav.location, favoriteConditionLabel(fav.condition)].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* S4.2 — Pending-offer alert: ≤2 actionable offers, nothing when none.
          The "is-actionable / max 2 / buyer-vs-seller" logic is in lib/home-offer-alert.ts. */}
      {offerAlerts.length > 0 && (
        <section className="mb-6" data-testid="home-offer-alert" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {offerAlerts.map(alert => (
            <Link
              key={`${alert.perspective}-${alert.offerId}`}
              href={alert.href}
              className="card-tile no-underline"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'var(--promo-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <i className={alert.icon} style={{ fontSize: 20, color: 'var(--promo)' }} aria-hidden />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {alert.title}
                </p>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {alert.subtitle}
                </p>
              </div>
              <span style={{ flexShrink: 0, fontSize: 13, color: 'var(--accent)', whiteSpace: 'nowrap' }}>Ver →</span>
            </Link>
          ))}
        </section>
      )}
    </>
  )
}
