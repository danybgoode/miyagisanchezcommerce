'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useHomePersonalization } from './HomePersonalizationProvider'
import { priceLabel, favoriteConditionLabel } from '@/lib/home-personalization'
import { deriveOfferAlerts } from '@/lib/home-offer-alert'
import { readRecentlyViewed } from '@/lib/home-recently-viewed'
import { mergeRailCards, type RailCard, type ViewedWithCard } from '@/lib/home-recently-viewed-merge'

/**
 * Marketplace static-shell — Sprint 4. The top personalization slot: the signed-in
 * "Retoma donde te quedaste" rail (newest favorites + recently-viewed, S2.3) + the ≤2
 * pending-offer alerts. Markup is verbatim from the pre-S2 `app/page.tsx` signed-in
 * block; the data now comes from the client island fetch (`HomePersonalizationProvider`)
 * instead of a server read. Renders nothing until data lands, and each section hides
 * when empty — so the static page is unaffected for signed-out/loading visitors.
 */
export default function HomeRetomaOffers() {
  const data = useHomePersonalization()
  const [railCards, setRailCards] = useState<RailCard[]>([])

  const recentFavorites = data?.recentFavorites ?? []
  // A stable, content-based key (not the `data` object identity) so the effect below
  // only re-runs when a favorite's actual fields change — not on every re-render that
  // happens to produce a new (but equal) `data` object from the provider. Cheap at this
  // scale (≤3 favorites).
  const favoritesContentKey = JSON.stringify(recentFavorites)

  // S2.3 — merge in recently-viewed (device-local, no auth needed). Runs once favorites
  // are known so the favorites-win-on-collision filter has real ids to check against;
  // re-runs only when a favorite's actual content changes.
  useEffect(() => {
    let cancelled = false
    const favoriteIds = new Set(recentFavorites.map(f => f.medusaId))
    const viewed = readRecentlyViewed().filter(v => !favoriteIds.has(v.id))

    if (viewed.length === 0) {
      setRailCards(mergeRailCards(recentFavorites, [], Date.now()))
      return
    }

    const ids = viewed.map(v => encodeURIComponent(v.id)).join(',')
    fetch(`/api/listings/by-ids?ids=${ids}`)
      .then(res => (res.ok ? res.json() : { listings: [] }))
      .then((json: { listings?: ViewedWithCard['card'][] }) => {
        if (cancelled) return
        const cardById = new Map((json.listings ?? []).map(c => [c.medusaId, c]))
        const viewedWithCards: ViewedWithCard[] = viewed
          .filter(v => cardById.has(v.id)) // sold/delisted since viewing — silently drop
          .map(v => ({ ts: v.ts, card: cardById.get(v.id)! }))
        setRailCards(mergeRailCards(recentFavorites, viewedWithCards, Date.now()))
      })
      .catch(() => {
        if (!cancelled) setRailCards(mergeRailCards(recentFavorites, [], Date.now()))
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesContentKey])

  if (!data) return null

  const offerAlerts = deriveOfferAlerts(data.offerAlertInputs ?? [])

  return (
    <>
      {/* S4.1 — "Retoma donde te quedaste" rail: favorites + recently-viewed (S2.3),
          combined cap RAIL_CAP. Hidden when empty. */}
      {railCards.length > 0 && (
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
            {railCards.map(card => (
              <Link
                key={card.medusaId}
                href={`/l/${card.medusaId}`}
                className="card-tile no-underline"
                style={{ flex: '0 0 auto', width: 150 }}
              >
                <div style={{ position: 'relative' }}>
                  {card.imageUrl ? (
                    <img src={card.imageUrl} alt={card.title} className="w-full object-cover" style={{ aspectRatio: '1 / 1' }} />
                  ) : (
                    <div className="w-full flex items-center justify-center" style={{ aspectRatio: '1 / 1', background: 'var(--bg-sunk)' }}>
                      <i className="iconoir-package" style={{ fontSize: 32, color: 'var(--fg-subtle)' }} />
                    </div>
                  )}
                  {card.priceDrop.dropped ? (
                    <span
                      className="badge badge-danger"
                      style={{ position: 'absolute', top: 6, left: 6, fontSize: 10, fontWeight: 700 }}
                    >
                      ↓ Bajó {priceLabel(card.priceDrop.dropAmountCents, card.currency)}
                    </span>
                  ) : (
                    <span
                      className="badge badge-soft"
                      style={{ position: 'absolute', top: 6, left: 6, fontSize: 10, fontWeight: 600 }}
                    >
                      {card.label}
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="t-price" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>
                    {priceLabel(card.priceCents, card.currency)}
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '3px 0 0' }}>
                    {card.title}
                  </p>
                  {(card.location || card.condition) && (
                    <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {[card.location, favoriteConditionLabel(card.condition)].filter(Boolean).join(' · ')}
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
