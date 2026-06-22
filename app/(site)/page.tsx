import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  getFeaturedListing,
  getCuratedListings,
  getCategoryCounts,
  getShopListings,
  formatPrice,
  conditionLabel,
} from '@/lib/listings'
import { isRecentForBadge } from '@/lib/home-curation'
import { getRecentFavorites, type RecentFavorite } from '@/lib/home-favorites'
import { deriveOfferAlerts, type OfferAlertInput, type OfferAlert } from '@/lib/home-offer-alert'
import type { Listing } from '@/lib/types'
import CategoryChips from '@/app/components/CategoryChips'
import FavoriteButton from '@/app/components/FavoriteButton'
import {
  NEIGHBORHOOD_PULSE_COPY,
  printSocialTypeLabel,
  publicSubmitterLabel,
} from '@/lib/neighborhood-pulse'
import { getNeighborhoodPulseItems } from '@/lib/neighborhood-pulse-server'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  return `Hace ${hrs} h`
}

// Price label for the retoma rail (RecentFavorite carries cents + currency, not a Listing).
function priceLabel(cents: number | null, currency: string): string {
  if (cents == null) return 'Precio a consultar'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
}

// Supabase returns a to-one join as an object, but the generated types widen it to an
// array — normalize to the single row either way.
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

// The shape of the listing join on an offer row (to-one, possibly array-wrapped).
type OfferShop = { name?: string | null }
type OfferListing = {
  title?: string | null
  currency?: string | null
  marketplace_shops?: OfferShop | OfferShop[] | null
}
type OfferRow = {
  id: string
  offer_amount_cents: number
  status: OfferAlertInput['status']
  expires_at: string
  marketplace_listings?: OfferListing | OfferListing[] | null
}

export default async function HomePage() {
  // One timestamp for both the featured pick and the grid so their selection is
  // atomic (no 14-day-cutoff divergence between the two reads).
  const now = Date.now()
  const [featured, grid, categories, pulse, user] = await Promise.all([
    getFeaturedListing(now),
    getCuratedListings(4, now),
    getCategoryCounts(),
    getNeighborhoodPulseItems(2), // S3.4 live strip — same approved source as /vecindario, degrades to []
    currentUser(),
  ])

  const seleccion: Listing[] = [...(featured ? [featured] : []), ...grid]

  let favoritedIds = new Set<string>()
  if (user && seleccion.length > 0) {
    const ids = seleccion.map(l => l.id)
    const { data: favs } = await db
      .from('marketplace_favorites')
      .select('marketplace_listings!inner(medusa_product_id)')
      .eq('clerk_user_id', user.id)
      .in('marketplace_listings.medusa_product_id', ids)
    favoritedIds = new Set(
      (favs ?? [])
        .map(f => {
          const listing = f.marketplace_listings as unknown as { medusa_product_id?: string | null } | { medusa_product_id?: string | null }[]
          return Array.isArray(listing) ? listing[0]?.medusa_product_id : listing?.medusa_product_id
        })
        .filter((id): id is string => !!id),
    )
  }
  const isSignedIn = !!user

  // ── Signed-in modules (Sprint 4) ───────────────────────────────────────────
  // Recognise the returning user. Every read is null-safe (`?? []`) so these ship
  // independent of one another and of S4.4 (no price-drop badge in v1).
  let recentFavorites: RecentFavorite[] = []
  let offerAlerts: OfferAlert[] = []
  let hasShop = false
  let sellerSnapshot: { shopName: string; visitas: number; ofertasNuevas: number } | null = null

  if (user) {
    // Resolve the user's shop from the Supabase mirror — one cheap call, no Clerk JWT,
    // same lookup as app/shop/manage/offers/page.tsx.
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('id, slug, name')
      .eq('clerk_user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    hasShop = !!shop

    const [favs, buyerOffersRes, sellerOffersRes] = await Promise.all([
      getRecentFavorites(user.id, 3),
      db
        .from('marketplace_offers')
        .select('id, offer_amount_cents, status, expires_at, marketplace_listings!inner(title, currency, marketplace_shops(name))')
        .eq('buyer_clerk_user_id', user.id)
        .eq('status', 'pending')
        .order('expires_at', { ascending: true })
        .limit(10),
      shop
        ? db
            .from('marketplace_offers')
            .select('id, offer_amount_cents, status, expires_at, marketplace_listings!inner(title, currency)')
            .eq('shop_id', shop.id)
            .eq('status', 'pending')
            .order('expires_at', { ascending: true })
            .limit(10)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ])
    recentFavorites = favs

    const buyerOffers = (buyerOffersRes.data ?? []) as unknown as OfferRow[]
    const sellerOffers = (sellerOffersRes.data ?? []) as unknown as OfferRow[]

    // Resolve conversation ids so each alert deep-links to its thread.
    const offerIds = [...buyerOffers, ...sellerOffers].map(o => o.id)
    let convByOfferId: Record<string, string> = {}
    if (offerIds.length > 0) {
      const { data: convs } = await db
        .from('marketplace_conversations')
        .select('id, offer_id')
        .in('offer_id', offerIds)
      convByOfferId = Object.fromEntries(
        (convs ?? []).filter(c => c.offer_id).map(c => [c.offer_id as string, c.id as string]),
      )
    }

    const alertInputs: OfferAlertInput[] = [
      ...buyerOffers.map((o): OfferAlertInput => {
        const listing = one(o.marketplace_listings)
        return {
          offerId: o.id,
          conversationId: convByOfferId[o.id] ?? null,
          perspective: 'buyer',
          status: o.status,
          expiresAt: o.expires_at,
          amountCents: o.offer_amount_cents,
          currency: listing?.currency ?? 'MXN',
          listingTitle: listing?.title ?? 'Anuncio',
          shopName: one(listing?.marketplace_shops)?.name ?? null,
        }
      }),
      ...sellerOffers.map((o): OfferAlertInput => {
        const listing = one(o.marketplace_listings)
        return {
          offerId: o.id,
          conversationId: convByOfferId[o.id] ?? null,
          perspective: 'seller',
          status: o.status,
          expiresAt: o.expires_at,
          amountCents: o.offer_amount_cents,
          currency: listing?.currency ?? 'MXN',
          listingTitle: listing?.title ?? 'Anuncio',
          shopName: null,
        }
      }),
    ]
    offerAlerts = deriveOfferAlerts(alertInputs, now)

    // Seller snapshot (S4.3): visitas = sum of the shop's listing views (cached read);
    // ofertas nuevas = pending offers we already fetched for the alert.
    if (shop) {
      const shopListings = await getShopListings(shop.slug)
      const visitas = shopListings.reduce((sum, l) => sum + (l.views ?? 0), 0)
      sellerSnapshot = { shopName: shop.name, visitas, ofertasNuevas: sellerOffers.length }
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      {/* S3.1 — Value-prop ribbon (signed-out only): one-line orientation in place of a hero */}
      {!isSignedIn && (
        <div
          data-testid="home-ribbon"
          className="mb-6"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            background: 'var(--accent-soft)',
            border: '1px solid var(--selva-100)',
            borderRadius: 'var(--r-sm)',
            padding: '9px 14px',
          }}
        >
          <i className="iconoir-shield-check" style={{ fontSize: 16, color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
          <span style={{ fontSize: 13, color: 'var(--fg)' }}>
            Compra y vende en México — gratis, protegido y con ofertas.
          </span>
          <Link href="/acerca" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Cómo funciona →
          </Link>
        </div>
      )}

      {/* S4.1 — "Retoma donde te quedaste" rail (signed-in): newest 3 favorites, the first
          content module. No price-drop badge in v1 (deferred). Hidden when empty. */}
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
                      {[fav.location, conditionLabel(fav.condition as Listing['condition'])].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* S4.2 — Pending-offer alert (signed-in): ≤2 actionable offers, nothing when none.
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

      <CategoryChips className="mb-6" />

      {/* S3.4 — Vecindario live strip: 1–2 real approved pulse items from the same source as
          /vecindario. Empty → the original banner. The "Ver vecindario →" link keeps the
          data-testid so the nav-entry-points spec stays green. */}
      {pulse.length > 0 ? (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {NEIGHBORHOOD_PULSE_COPY.eyebrow}
            </p>
            <Link
              href="/vecindario"
              data-testid="vecindario-feed-entry"
              style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              {NEIGHBORHOOD_PULSE_COPY.viewFeedCta} →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pulse.map(item => (
              <div
                key={item.id}
                className="card-tile"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14 }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--bg-sunk)',
                  }}
                >
                  <i
                    className={item.type === 'evento' ? 'iconoir-bell' : 'iconoir-star'}
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                    aria-hidden
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="badge badge-soft" style={{ color: 'var(--accent)', fontSize: 10 }}>
                    {printSocialTypeLabel(item.type)}
                  </span>
                  <p style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.4, margin: '6px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {item.caption || item.body}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[publicSubmitterLabel(item), item.zone, timeAgo(item.created_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <Link
          href="/vecindario"
          data-testid="vecindario-feed-entry"
          className="card-tile no-underline block mb-6"
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
            <i className="iconoir-community" style={{ fontSize: 24, color: 'var(--accent)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
              {NEIGHBORHOOD_PULSE_COPY.eyebrow}
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>
              {NEIGHBORHOOD_PULSE_COPY.navLabel}
            </p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {NEIGHBORHOOD_PULSE_COPY.intro}
            </p>
          </div>
          <span style={{ flexShrink: 0, fontSize: 13, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
            {NEIGHBORHOOD_PULSE_COPY.viewFeedCta} →
          </span>
        </Link>
      )}

      {/* Selección de la semana — a curated pick + grid, price as the loudest element */}
      {seleccion.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)' }}>
              Selección de la semana
            </h2>
            <Link href="/l" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
              Ver todo →
            </Link>
          </div>

          {/* Featured card — full-width 16:9, price 18px loudest */}
          {featured && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Link href={`/l/${featured.id}`} className="card-tile no-underline block">
                <div style={{ position: 'relative' }}>
                  {featured.images?.[0] ? (
                    <img
                      src={featured.images[0].url}
                      alt={featured.images[0].alt ?? featured.title}
                      className="w-full object-cover"
                      style={{ aspectRatio: '16 / 9' }}
                    />
                  ) : (
                    <div className="w-full flex items-center justify-center" style={{ aspectRatio: '16 / 9', background: 'var(--bg-sunk)' }}>
                      <i className="iconoir-package" style={{ fontSize: 48, color: 'var(--fg-subtle)' }} />
                    </div>
                  )}
                  <span
                    className="badge"
                    style={{ position: 'absolute', top: 10, left: 10, fontSize: 11, fontWeight: 600, background: 'var(--accent)', color: 'var(--fg-inverse)' }}
                  >
                    Destacado
                  </span>
                </div>
                <div className="p-3">
                  <p className="t-price" style={{ fontSize: 18, fontWeight: 600 }}>{formatPrice(featured)}</p>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', margin: '4px 0' }}>
                    {featured.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
                    {featured.location && <span>{featured.location}</span>}
                    {featured.location && featured.shop && <span style={{ color: 'var(--fg-subtle)' }}>·</span>}
                    {featured.shop && (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {featured.shop.verified && <i className="iconoir-badge-check" style={{ color: 'var(--accent)', marginRight: 3, verticalAlign: 'middle' }} aria-hidden />}
                        {featured.shop.name}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}>
                <FavoriteButton
                  listingId={featured.id}
                  initialFavorited={favoritedIds.has(featured.id)}
                  isSignedIn={isSignedIn}
                  size="sm"
                />
              </div>
            </div>
          )}

          {/* Grid — price 16px loudest, ONE meta line, <48h timestamp badge */}
          {grid.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {grid.map(listing => (
                <div key={listing.id} style={{ position: 'relative' }}>
                  <Link href={`/l/${listing.id}`} className="card-tile no-underline block">
                    <div style={{ position: 'relative' }}>
                      {listing.images?.[0] ? (
                        <img
                          src={listing.images[0].url}
                          alt={listing.images[0].alt ?? listing.title}
                          className="w-full object-cover"
                          style={{ aspectRatio: '1 / 1' }}
                        />
                      ) : (
                        <div className="w-full flex items-center justify-center" style={{ aspectRatio: '1 / 1', background: 'var(--bg-sunk)' }}>
                          <i className="iconoir-package" style={{ fontSize: 36, color: 'var(--fg-subtle)' }} />
                        </div>
                      )}
                      {isRecentForBadge(listing.created_at, now) && (
                        <span
                          className="badge badge-soft"
                          style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 10 }}
                        >
                          {timeAgo(listing.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="t-price" style={{ fontSize: 16, fontWeight: 600 }}>{formatPrice(listing)}</p>
                      <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', margin: '3px 0' }}>
                        {listing.title}
                      </p>
                      {(listing.location || listing.condition) && (
                        <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[listing.location, conditionLabel(listing.condition)].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </Link>
                  <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 5 }}>
                    <FavoriteButton
                      listingId={listing.id}
                      initialFavorited={favoritedIds.has(listing.id)}
                      isSignedIn={isSignedIn}
                      size="sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Categorías con vida — only categories with ≥1 active listing, with live counts */}
      {categories.length > 0 && (
        <section className="mb-8">
          <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)', marginBottom: 16 }}>
            Categorías
          </h2>
          <div className="card-tile" style={{ padding: 0, overflow: 'hidden' }}>
            {categories.map((cat, i) => (
              <Link
                key={cat.key}
                href={`/l?category=${cat.key}`}
                className="no-underline"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <i className={`iconoir-${cat.icon}`} style={{ fontSize: 17, color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
                <span style={{ flex: 1, fontSize: 13.5, color: 'var(--fg)' }}>{cat.label}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{cat.count}</span>
                <i className="iconoir-arrow-right" style={{ fontSize: 15, color: 'var(--fg-subtle)', flexShrink: 0 }} aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}

      {seleccion.length === 0 && categories.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--fg-muted)' }}>
          <i className="iconoir-shop" style={{ fontSize: 48, color: 'var(--fg-subtle)', display: 'block', marginBottom: 12 }} />
          <p style={{ fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>El marketplace está tomando forma</p>
          <p style={{ fontSize: 14, marginBottom: 16 }}>Las primeras publicaciones aparecerán aquí pronto.</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/vende" className="btn btn-primary btn-sm">Publica lo primero</Link>
            <Link href="/vecindario" className="btn btn-secondary btn-sm">Pasea por el vecindario</Link>
          </div>
        </div>
      )}

      {/* S3.3 — Terminal CTA (signed-out): a clear next action so the bottom isn't a dead end */}
      {!isSignedIn && seleccion.length > 0 && (
        <section
          className="mb-4"
          style={{
            textAlign: 'center',
            padding: '28px 16px',
            borderTop: '1px solid var(--border)',
            marginTop: 8,
          }}
        >
          <p style={{ fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)', marginBottom: 4 }}>
            Únete a la comunidad
          </p>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>
            Guarda favoritos, haz ofertas y abre tu tienda — sin comisiones.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/sign-up" className="btn btn-primary">Crear cuenta</Link>
            <Link href="/l" className="btn btn-secondary">Seguir explorando</Link>
          </div>
        </section>
      )}

      {/* S4.3 — Seller block (signed-in): a shop snapshot when the user sells, else a minimal
          recruit card. Sits at the bottom in place of the signed-out terminal CTA. */}
      {isSignedIn && (
        hasShop && sellerSnapshot ? (
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
                  {sellerSnapshot.visitas} visita{sellerSnapshot.visitas === 1 ? '' : 's'} · {sellerSnapshot.ofertasNuevas} oferta{sellerSnapshot.ofertasNuevas === 1 ? '' : 's'} nueva{sellerSnapshot.ofertasNuevas === 1 ? '' : 's'}
                </p>
              </div>
              <Link href="/sell" className="btn btn-primary btn-sm no-underline" style={{ flexShrink: 0 }}>
                Publicar otro
              </Link>
            </div>
          </section>
        ) : (
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
      )}
    </div>
  )
}
