'use client'

import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
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
 * instead of a server read.
 *
 * Loading state (2026-07): while the session is still resolving, or for a signed-out
 * visitor, this renders nothing — identical to the static markup, so there's no
 * hydration mismatch and no skeleton flash for the (majority) anonymous case. Once
 * we're sure the visitor is signed in, `showRailSkeleton` covers both the
 * personalization fetch AND the recently-viewed by-ids fetch below, so the rail
 * reserves its final height immediately and cross-fades into real cards instead of
 * popping in and pushing the rest of the page down. The offer-alert section still
 * pops in when it resolves (max 2 items, size isn't predictable enough to skeleton
 * usefully) — a smaller, rarer jump than the rail was.
 */
export default function HomeRetomaOffers() {
  const { data, isLoaded, isSignedIn, settled } = useHomePersonalization()
  // Stored WITH the favorites key it was built from, so "these cards are stale" is DERIVED during
  // render instead of reset by the effect (same pattern as the provider). That is what lets the
  // effect drop its synchronous `setRailReady(false)` / `setRailCards([])` — banned by
  // `react-hooks/set-state-in-effect`, and a cascading render for a value that was never really
  // state. A sign-out or account switch changes the key, so the previous session's rail stops
  // counting immediately rather than lingering for a frame.
  const [rail, setRail] = useState<{ key: string; cards: RailCard[] } | null>(null)

  const recentFavorites = data?.recentFavorites ?? []
  // A stable, content-based key (not the `data` object identity) so the effect below
  // only re-runs when a favorite's actual fields change — not on every re-render that
  // happens to produce a new (but equal) `data` object from the provider. Cheap at this
  // scale (≤3 favorites).
  const favoritesContentKey = JSON.stringify(recentFavorites)

  // S2.3 — merge in recently-viewed (device-local, no auth needed). Runs once favorites
  // are known so the favorites-win-on-collision filter has real ids to check against;
  // re-runs only when a favorite's actual content changes. Skips the by-ids fetch
  // entirely while `data` is still null — nothing to merge favorites against yet, even
  // though the rail itself is already visible as a skeleton at this point.
  useEffect(() => {
    // Signed out, session still resolving, or the personalization fetch hasn't landed — nothing
    // to merge favorites against yet, so there is no by-ids fetch to make. The rail is already
    // showing a skeleton at this point; staleness is handled by the key check during render.
    if (!data) return

    let cancelled = false
    const key = favoritesContentKey
    const finish = (viewedWithCards: ViewedWithCard[]) => {
      if (!cancelled) setRail({ key, cards: mergeRailCards(recentFavorites, viewedWithCards, Date.now()) })
    }

    const favoriteIds = new Set(recentFavorites.map(f => f.medusaId))
    const viewed = readRecentlyViewed().filter(v => !favoriteIds.has(v.id))

    if (viewed.length === 0) {
      // Nothing device-local to hydrate — resolve on a microtask rather than inline, so this stays
      // out of the effect body proper (the same set-state-in-effect rule as above). One tick is
      // imperceptible and the skeleton is already on screen covering it.
      Promise.resolve().then(() => finish([]))
      return () => { cancelled = true }
    }

    const ids = viewed.map(v => encodeURIComponent(v.id)).join(',')
    fetch(`/api/listings/by-ids?ids=${ids}`)
      .then(res => (res.ok ? res.json() : { listings: [] }))
      .then((json: { listings?: ViewedWithCard['card'][] }) => {
        if (cancelled) return
        const cardById = new Map((json.listings ?? []).map(c => [c.medusaId, c]))
        finish(
          viewed
            .filter(v => cardById.has(v.id)) // sold/delisted since viewing — silently drop
            .map(v => ({ ts: v.ts, card: cardById.get(v.id)! }))
        )
      })
      .catch(() => finish([]))

    return () => { cancelled = true }
    // `!!data` catches the null→object transition (e.g. a signed-in user with zero
    // favorites) that `favoritesContentKey` alone can't see, since `recentFavorites`
    // defaults to `[]` both before and after when there are no favorites either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data, favoritesContentKey])

  // Session still resolving — render nothing, matching the static/signed-out markup
  // exactly so hydration never mismatches. This is the one unavoidable brief window;
  // it resolves to either "signed out" (stays nothing, no skeleton ever shown) or
  // "signed in" (skeleton takes over below) within one effect pass.
  if (!isLoaded) return null
  if (!isSignedIn) return null

  const offerAlerts = data ? deriveOfferAlerts(data.offerAlertInputs ?? []) : []
  // Cards only count when they were built from the favorites currently in hand — see the `rail`
  // note at the top. A stale key reads as not-ready, which is what makes the reset derivable.
  const railReady = rail?.key === favoritesContentKey
  const railCards = railReady ? rail!.cards : []
  // True for the whole window from "we know they're signed in" to "the rail has its
  // final cards" — covers the personalization fetch and the by-ids fetch as one span,
  // so the skeleton doesn't hand off to a second, shorter pop-in partway through.
  //
  // Keyed off `settled`, NOT `!data`: once the personalization fetch has settled with no
  // data (a failed/blocked fetch — routine off the prod origin), there is nothing further
  // coming, and a skeleton that outlives its fetch shimmers forever. In that case the
  // whole section falls away below, exactly as it did before skeletons existed. The
  // `data && !railReady` half keeps the skeleton up across the second (by-ids) hop.
  const showRailSkeleton = !settled || (!!data && !railReady)

  return (
    <>
      {/* S4.1 — "Retoma donde te quedaste" rail: favorites + recently-viewed (S2.3),
          combined cap RAIL_CAP. Skeleton reserves this section's height while pending;
          hidden only once we know for sure there's nothing to show (railReady && empty). */}
      {(showRailSkeleton || railCards.length > 0) && (
        <section className="mb-6" data-testid="home-retoma-rail">
          <div className="flex items-center justify-between mb-3">
            {showRailSkeleton ? (
              // Dimensions are the "standard" option from references/homepage-loader-options.html
              // verbatim. The card WIDTH deliberately stays at the rail's real 150px rather than
              // the mockup's 120px — that mockup is a scaled-down demo, and the whole point of the
              // skeleton is to reserve the real final height so nothing below it shifts.
              <div className="skeleton" style={{ width: 150, height: 15, borderRadius: 4 }} />
            ) : (
              <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)' }}>
                <BuyerCopyText copyKey="components.HomeRetomaOffers.f770e542" /></h2>
            )}
            <Link href="/account/favorites" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              <BuyerCopyText copyKey="components.HomeRetomaOffers.01d87486" /></Link>
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {showRailSkeleton
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ flex: '0 0 auto', width: 150 }}>
                    <div className="skeleton" style={{ width: '100%', aspectRatio: '1 / 1' }} />
                    <div className="skeleton" style={{ width: '70%', height: 12, borderRadius: 4, marginTop: 8 }} />
                    <div className="skeleton" style={{ width: '90%', height: 10, borderRadius: 4, marginTop: 6 }} />
                  </div>
                ))
              : railCards.map(card => (
                  <Link
                    key={card.medusaId}
                    href={`/mx/l/${card.medusaId}`}
                    className="card-tile no-underline fade-in"
                    style={{ flex: '0 0 auto', width: 150 }}
                  >
                    <div style={{ position: 'relative' }}>
                      {card.imageUrl ? (
                        // Raw <img>, matching the other 40-odd seller-image surfaces here: these
                        // are remote R2 uploads, so next/image would route every rail thumbnail
                        // through the optimizer — a metered cost and a remotePatterns change, not
                        // a like-for-like swap. Pre-existing; called out rather than forced,
                        // per lint-changed's own advice.
                        // eslint-disable-next-line @next/next/no-img-element
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
                          <BuyerCopyText copyKey="components.HomeRetomaOffers.d96b1742" />{' '}{priceLabel(card.priceDrop.dropAmountCents, card.currency)}
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
              <span style={{ flexShrink: 0, fontSize: 13, color: 'var(--accent)', whiteSpace: 'nowrap' }}><BuyerCopyText copyKey="components.HomeRetomaOffers.e212f03a" /></span>
            </Link>
          ))}
        </section>
      )}
    </>
  )
}
