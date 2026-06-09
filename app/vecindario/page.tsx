import type { Metadata } from 'next'
import Link from 'next/link'
import {
  formatPulseDate,
  NEIGHBORHOOD_PULSE_COPY,
  printSocialTypeLabel,
  publicSubmitterLabel,
} from '@/lib/neighborhood-pulse'
import {
  getNeighborhoodPulseItems,
  getNeighborhoodSpotlightShops,
  getTrendingNeighborhoodListings,
  type NeighborhoodSpotlightShop,
  type NeighborhoodTrendingListing,
} from '@/lib/neighborhood-pulse-server'
import type { PrintSocialSubmission } from '@/lib/print'
import { formatPrice } from '@/lib/listings'

export const metadata: Metadata = {
  title: 'Vecindario',
  description: 'El pulso local de recomendaciones, reconocimientos y avisos compartidos por la comunidad Miyagi.',
}

function SocialCard({ item }: { item: PrintSocialSubmission }) {
  const photos = Array.isArray(item.photos) ? item.photos.filter(Boolean).slice(0, 3) : []
  const date = formatPulseDate(item.created_at)

  return (
    <article className="card-tile overflow-hidden">
      {photos.length > 0 ? (
        <div className={photos.length === 1 ? 'grid' : 'grid grid-cols-2 gap-px'} style={{ background: 'var(--border)' }}>
          {photos.map((photo, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo}
              src={photo}
              alt={index === 0 ? item.caption : ''}
              className={photos.length === 1 ? 'h-56 w-full object-cover' : 'h-36 w-full object-cover'}
            />
          ))}
        </div>
      ) : (
        <div className="flex h-28 items-center justify-center gap-2" style={{ background: 'var(--bg-sunk)', color: 'var(--fg-muted)' }}>
          <i className="iconoir-community" style={{ fontSize: 22 }} />
          <span className="text-sm">{NEIGHBORHOOD_PULSE_COPY.noPhoto}</span>
        </div>
      )}

      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="badge badge-soft" style={{ color: 'var(--accent)' }}>
            {printSocialTypeLabel(item.type)}
          </span>
          {item.zone && (
            <span className="badge badge-soft">
              {item.zone}
            </span>
          )}
          {date && <span className="text-xs" style={{ color: 'var(--fg-subtle)' }}>{date}</span>}
        </div>

        <h2 className="text-base font-semibold leading-snug" style={{ color: 'var(--fg)', letterSpacing: 0 }}>
          {item.caption}
        </h2>
        {item.body && (
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--fg-muted)' }}>
            {item.body}
          </p>
        )}

        <p className="mt-3 text-xs" style={{ color: 'var(--fg-subtle)' }}>
          {publicSubmitterLabel(item)}
        </p>
      </div>
    </article>
  )
}

function TrendingStrip({ listings }: { listings: NeighborhoodTrendingListing[] }) {
  if (listings.length === 0) return null

  return (
    <section aria-labelledby="vecindario-tendencias" className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="vecindario-tendencias" className="text-lg font-semibold" style={{ color: 'var(--fg)', letterSpacing: 0 }}>
            {NEIGHBORHOOD_PULSE_COPY.trendingTitle}
          </h2>
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            {NEIGHBORHOOD_PULSE_COPY.trendingIntro}
          </p>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {listings.map((listing) => (
          <Link
            key={listing.id}
            href={`/l/${listing.id}`}
            className="card-tile block w-44 flex-shrink-0 overflow-hidden no-underline sm:w-52"
          >
            {listing.images?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.images[0].url}
                alt={listing.images[0].alt ?? listing.title}
                className="h-28 w-full object-cover"
              />
            ) : (
              <div className="flex h-28 items-center justify-center" style={{ background: 'var(--bg-sunk)' }}>
                <i className="iconoir-package" style={{ fontSize: 28, color: 'var(--fg-subtle)' }} />
              </div>
            )}
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-medium leading-snug" style={{ color: 'var(--fg)' }}>
                {listing.title}
              </p>
              <p className="t-price mt-1 text-sm">{formatPrice(listing)}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--fg-subtle)' }}>
                {listing.shop?.name ?? listing.location ?? 'Miyagi'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function MerchantSpotlightStrip({ shops }: { shops: NeighborhoodSpotlightShop[] }) {
  if (shops.length === 0) return null

  return (
    <section aria-labelledby="vecindario-comercios" className="mb-8">
      <div className="mb-3">
        <h2 id="vecindario-comercios" className="text-lg font-semibold" style={{ color: 'var(--fg)', letterSpacing: 0 }}>
          {NEIGHBORHOOD_PULSE_COPY.spotlightTitle}
        </h2>
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          {NEIGHBORHOOD_PULSE_COPY.spotlightIntro}
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {shops.map((shop) => (
          <Link
            key={shop.slug}
            href={`/s/${shop.slug}`}
            className="card-tile block w-64 flex-shrink-0 p-4 no-underline sm:w-72"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background: 'var(--bg-sunk)' }}>
                {shop.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shop.logo_url} alt={shop.name} className="h-full w-full object-cover" />
                ) : (
                  <i className="iconoir-shop" style={{ fontSize: 24, color: 'var(--fg-subtle)' }} />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="line-clamp-1 text-base font-semibold leading-tight" style={{ color: 'var(--fg)', letterSpacing: 0 }}>
                  {shop.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm leading-5" style={{ color: 'var(--fg-muted)' }}>
                  {shop.tagline}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="badge badge-soft">
                {shop.colonia}
              </span>
              <span className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
                {shop.listing_count === 1 ? '1 anuncio reciente' : `${shop.listing_count} anuncios recientes`}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default async function NeighborhoodPulsePage() {
  const [items, spotlightShops, trending] = await Promise.all([
    getNeighborhoodPulseItems(),
    getNeighborhoodSpotlightShops(),
    getTrendingNeighborhoodListings(),
  ])

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 pb-24">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--accent)', letterSpacing: 0 }}>
          {NEIGHBORHOOD_PULSE_COPY.eyebrow}
        </p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold leading-tight" style={{ color: 'var(--fg)', letterSpacing: 0 }}>
              {NEIGHBORHOOD_PULSE_COPY.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--fg-muted)' }}>
              {NEIGHBORHOOD_PULSE_COPY.intro}
            </p>
          </div>
          <Link href="/comunidad/nuevo" className="btn btn-primary btn-sm w-fit">
            <i className="iconoir-megaphone" style={{ fontSize: 14 }} />
            {NEIGHBORHOOD_PULSE_COPY.contributeCta}
          </Link>
        </div>
      </header>

      <MerchantSpotlightStrip shops={spotlightShops} />

      <TrendingStrip listings={trending} />

      {items.length === 0 ? (
        <section
          aria-label="Vecindario sin aportes"
          className="rounded-xl border-2 border-dashed p-10 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
        >
          <i className="iconoir-community" style={{ display: 'block', fontSize: 40, color: 'var(--fg-subtle)', marginBottom: 12 }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--fg)', letterSpacing: 0 }}>
            {NEIGHBORHOOD_PULSE_COPY.emptyTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6" style={{ color: 'var(--fg-muted)' }}>
            {NEIGHBORHOOD_PULSE_COPY.emptyBody}
          </p>
          <Link href="/comunidad/nuevo" className="btn btn-primary btn-sm mt-5">
            <i className="iconoir-megaphone" style={{ fontSize: 14 }} />
            {NEIGHBORHOOD_PULSE_COPY.contributeCta}
          </Link>
        </section>
      ) : (
        <section aria-label="Aportes del vecindario" className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <SocialCard key={item.id} item={item} />
          ))}
        </section>
      )}
    </main>
  )
}
