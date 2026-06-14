import AskSellerButton from '@/app/components/AskSellerButton'
import { inmuebleHeroModel, inmuebleIconSpecs, zoneMapUrl, type InmuebleIconSpec } from '@/lib/inmueble-hero'

/**
 * InmuebleHero — PDP redesign (epic 01) Sprint 5, S5.2.
 *
 * For a property listing the page leads with this block: a glanceable icon spec
 * row (recámaras · baños · m² · estac.), an approximate-zone map link (the exact
 * address is never shown pre-visit — privacy/safety), and a primary "Agendar
 * visita" (links to the seller's calendar, or "Solicitar visita" via a
 * conversation when there's none). The full property specs table + buy/contact
 * bar stay below; this is a glanceable summary + primary-action emphasis.
 *
 * Presentational Server Component — the only client bit is the demoted
 * AskSellerButton. Decisions live in the pure `inmueble-hero` seam.
 */
export default function InmuebleHero({
  listingId,
  isSignedIn,
  bookingUrl,
  attrs,
  location,
}: {
  listingId: string
  isSignedIn: boolean
  bookingUrl: string | null
  attrs: Record<string, unknown> | null | undefined
  location: string | null
}) {
  const model = inmuebleHeroModel({ bookingUrl })
  const iconSpecs: InmuebleIconSpec[] = inmuebleIconSpecs(attrs)
  const mapUrl = zoneMapUrl(location)

  return (
    <div data-testid="pdp-inmueble-hero" style={{ marginBottom: 20 }}>
      {/* ── Icon spec row (hero) ─────────────────────────────────────────────── */}
      {iconSpecs.length > 0 && (
        <div
          data-testid="pdp-inmueble-iconspecs"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}
        >
          {iconSpecs.map(spec => (
            <div
              key={spec.label}
              style={{ flex: '1 1 0', minWidth: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'var(--bg-sunk)', borderRadius: 'var(--r-lg)', padding: '12px 8px' }}
            >
              <i className={spec.icon} style={{ fontSize: 20, color: 'var(--accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>{spec.value}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{spec.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Approximate-zone map link ────────────────────────────────────────── */}
      {mapUrl && (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="pdp-inmueble-zone-map"
          className="flex items-center gap-2 no-underline"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 12, color: 'var(--fg)' }}
        >
          <i className="iconoir-map-pin" style={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
          <div className="min-w-0 flex-1">
            <p style={{ fontSize: 13, fontWeight: 700 }}>Zona aproximada</p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{location} · la dirección exacta se comparte al agendar la visita</p>
          </div>
          <i className="iconoir-arrow-up-right" style={{ fontSize: 14, color: 'var(--fg-subtle)', flexShrink: 0 }} />
        </a>
      )}

      {/* ── Primary action: schedule a visit ─────────────────────────────────── */}
      {model.hasSchedule ? (
        <a
          href={bookingUrl!}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="pdp-inmueble-agendar"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          <i className="iconoir-calendar" style={{ fontSize: 16 }} />
          {model.primaryLabel}
        </a>
      ) : (
        <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label={model.primaryLabel} />
      )}
    </div>
  )
}
