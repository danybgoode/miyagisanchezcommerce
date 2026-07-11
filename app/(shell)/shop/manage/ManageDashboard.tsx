import { Fragment } from 'react'
import Link from 'next/link'
import PrintEditionCard from './PrintEditionCard'
import SetupGuideCard from './SetupGuideCard'
import { pendingSummary as buildPendingSummary } from '@/lib/seller-pending-summary'
import type { SetupStep } from '@/lib/setup-guide'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManagedListing {
  id: string
  title: string
  price_cents: number | null
  currency: string
  category: string | null
  listing_type: string
  condition: string | null
  status: string
  views: number
  images: Array<{ url: string; alt?: string }>
  created_at: string
}

interface Shop {
  id: string
  slug: string
  name: string
  location: string | null
}

// ── Main component ────────────────────────────────────────────────────────────
//
// The full "Mis anuncios" grid (search, filters, per-row pause/delete) was
// absorbed into the /shop/manage/catalogo table (catalog-management epic,
// Sprint 1 · Story 1.2) — this stays a compact summary card + link, so the
// dashboard doesn't duplicate a second live-editable listing grid.

export default function ManageDashboard({
  shop,
  initialListings,
  pendingOffersCount = 0,
  pendingOrdersCount = 0,
  setupSteps,
  guideDismissed = false,
}: {
  shop: Shop
  initialListings: ManagedListing[]
  pendingOffersCount?: number
  pendingOrdersCount?: number
  setupSteps: SetupStep[]
  guideDismissed?: boolean
}) {
  const totalViews = initialListings.reduce((s, l) => s + (l.views ?? 0), 0)
  const activeCount = initialListings.filter((l) => l.status === 'active').length
  const pausedCount = initialListings.filter((l) => l.status === 'paused').length
  const pendingSummary = buildPendingSummary(pendingOrdersCount, pendingOffersCount)
  const previewThumbs = initialListings.slice(0, 5)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">

      {/* ── Shop header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{shop.name}</h1>
          {shop.location && (
            <p className="text-sm text-[var(--color-muted)] mt-0.5">📍 {shop.location}</p>
          )}
          {/* Navigation lives in the SellerNav rail (lib/seller-nav.ts) — the
              dashboard header keeps only the public-shop link + a compact
              pending-work signal (the Pedidos/Ofertas badges' replacement). */}
          <div className="mt-2 flex flex-col gap-1">
            <Link
              href={`/s/${shop.slug}`}
              className="text-xs text-[var(--color-accent)] hover:underline no-underline w-fit"
              target="_blank"
            >
              Ver tienda pública ↗
            </Link>
            {pendingSummary && (
              <span className="text-xs text-[var(--color-muted)] inline-flex items-center gap-1.5 w-fit">
                <span className="inline-block w-1.5 h-1.5 rounded-[var(--r-pill)] bg-[var(--warning)]" aria-hidden />
                {pendingSummary.segments.map((seg, i) => (
                  <Fragment key={seg.href}>
                    {i > 0 && <span className="text-[var(--color-border)]">·</span>}
                    <Link href={seg.href} className="hover:text-[var(--color-foreground)] no-underline">
                      {seg.text}
                    </Link>
                  </Fragment>
                ))}
                <span>{pendingSummary.suffix}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          <Link
            href="/shop/manage/import"
            className="btn btn-secondary hidden sm:inline-block"
          >
            Importar
          </Link>
          <Link
            href="/sell"
            className="btn btn-primary"
          >
            + Nuevo anuncio
          </Link>
        </div>
      </div>

      {/* ── Setup guide (renders nothing once dismissed or all 5 steps done) ──── */}
      <SetupGuideCard steps={setupSteps} initialDismissed={guideDismissed} shopSlug={shop.slug} />

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Activos', value: activeCount, color: 'text-[var(--success)]' },
          { label: 'Pausados', value: pausedCount, color: 'text-[var(--warning)]' },
          { label: 'Vistas totales', value: totalViews, color: 'text-[var(--color-foreground)]' },
        ].map(stat => (
          <div key={stat.label} className="border border-[var(--color-border)] rounded-[var(--r-md)] p-4 text-center">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value.toLocaleString('es-MX')}</div>
            <div className="text-xs text-[var(--color-muted)] mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── Print edition power-up ──────────────────────────────────────────── */}
      <PrintEditionCard />

      {/* ── Mis anuncios — compact summary card ──────────────────────────────── */}
      <Link
        href="/shop/manage/catalogo"
        className="card-tile p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-[var(--color-muted)] uppercase tracking-wide">
            Mis anuncios ({initialListings.length})
          </h2>
          <span className="text-xs text-[var(--color-accent)] font-medium flex items-center gap-1">
            Ver catálogo completo <i className="iconoir-arrow-right" />
          </span>
        </div>

        {initialListings.length === 0 ? (
          <div className="py-4 text-center">
            <div className="text-3xl mb-2">📦</div>
            <p className="text-sm text-[var(--color-muted)]">
              Publica tu primer producto, servicio o renta en menos de 2 minutos.
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            {previewThumbs.map((listing) => (
              <div key={listing.id} className="w-14 h-14 flex-shrink-0 rounded-[var(--r-md)] overflow-hidden bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                {listing.images?.[0]?.url ? (
                  <img src={listing.images[0].url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
                )}
              </div>
            ))}
            {initialListings.length > previewThumbs.length && (
              <div className="w-14 h-14 flex-shrink-0 rounded-[var(--r-md)] flex items-center justify-center bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-muted)]">
                +{initialListings.length - previewThumbs.length}
              </div>
            )}
          </div>
        )}
      </Link>

      {/* ── Trust footer ────────────────────────────────────────────────────── */}
      <p className="text-xs text-center text-[var(--color-muted)] mt-10">
        ✓ Sin comisiones · ✓ Publicación instantánea · ✓ 100% gratis
      </p>
    </div>
  )
}
