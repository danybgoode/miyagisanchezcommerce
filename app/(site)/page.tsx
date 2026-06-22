import Link from 'next/link'
import {
  getFeaturedListing,
  getCuratedListings,
  getCategoryCounts,
  formatPrice,
  conditionLabel,
} from '@/lib/listings'
import { isRecentForBadge } from '@/lib/home-curation'
import type { Listing } from '@/lib/types'
import CategoryChips from '@/app/components/CategoryChips'
import FavoriteButton from '@/app/components/FavoriteButton'
import FavoritesProvider from '@/app/components/FavoritesProvider'
import {
  NEIGHBORHOOD_PULSE_COPY,
  printSocialTypeLabel,
  publicSubmitterLabel,
} from '@/lib/neighborhood-pulse'
import { getNeighborhoodPulseItems } from '@/lib/neighborhood-pulse-server'

// Prerender `/` as a static CDN asset, revalidated on the curated-content window
// (= CACHE.LISTING, lib/cache-policy.ts SSOT — kept a literal because Next requires
// `revalidate` to be statically analyzable). This is what turns the homepage from a
// per-request function (~30 s cold-start) into an ISR-prerendered static page.
export const revalidate = 60

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  return `Hace ${hrs} h`
}

/**
 * Marketplace homepage — the curated shell for EVERYONE, served as a static CDN asset
 * (marketplace-static-shell S2). Every read here is cached (`lib/cache-policy.ts` SSOT),
 * and the page reads no `currentUser()`/`headers()` — so Next prerenders `/` with no
 * per-request function, killing the ~30 s cold-start. Personalization (the retoma rail,
 * offer alerts, seller snapshot) is intentionally dropped here and returns in Phase 2 as
 * client islands (S3 Cloud Run endpoint + S4). Heart-states hydrate client-side via the
 * FavoritesProvider wrapping the curated grid.
 */
export default async function HomePage() {
  // One timestamp for both the featured pick and the grid so their selection is
  // atomic (no 14-day-cutoff divergence between the two reads).
  const now = Date.now()
  // Each read degrades to its empty fallback on failure (`.catch`) — because the page is
  // now prerendered at BUILD time, a thrown Medusa/Supabase fetch (e.g. a transient
  // backend hiccup during the Vercel build) would otherwise fail the whole deploy. Here
  // it just prerenders the empty-state and self-heals on the next ISR revalidation.
  const [featured, grid, categories, pulse] = await Promise.all([
    getFeaturedListing(now).catch(() => null),
    getCuratedListings(4, now).catch(() => []),
    getCategoryCounts().catch(() => []),
    getNeighborhoodPulseItems(2).catch(() => []), // S3.4 live strip — same approved source as /vecindario
  ])

  const seleccion: Listing[] = [...(featured ? [featured] : []), ...grid]

  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      {/* Value-prop ribbon: one-line orientation in place of a hero. Shown to everyone
          now that the page is static (no auth branch). */}
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

      {/* Selección de la semana — a curated pick + grid, price as the loudest element.
          Wrapped in FavoritesProvider: hearts hydrate client-side (one /api/favorites
          fetch) since the static render can't seed favorite state. */}
      {seleccion.length > 0 && (
        <FavoritesProvider>
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
                  <FavoriteButton listingId={featured.id} size="sm" />
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
                      <FavoriteButton listingId={listing.id} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </FavoritesProvider>
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

      {/* Terminal CTA — a clear next action so the bottom isn't a dead end. Shown to
          everyone now (static page, no auth branch); signed-in islands can refine in S4. */}
      {seleccion.length > 0 && (
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
    </div>
  )
}
