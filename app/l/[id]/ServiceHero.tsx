import AskSellerButton from '@/app/components/AskSellerButton'
import { serviceHeroModel } from '@/lib/service-hero'
import type { Spec } from '@/lib/listing-attributes'

/**
 * ServiceHero — PDP redesign (epic 01) Sprint 4, S4.1.
 *
 * For a service listing the page leads with this block instead of the boxed
 * buy/offer bar: a schedule card (primary "Agendar cita" → the seller's live
 * Cal.com calendar, or "Solicitar cita" when there's none) plus "Qué incluye"
 * built from the service attrs (`listingSpecs`) and the listing description.
 * "Preguntar" is demoted to a light link; there is no "Hacer oferta".
 *
 * Presentational Server Component — the only client bit is the demoted
 * AskSellerButton. The scheduling decision lives in the pure `serviceHeroModel`
 * seam so it's spec-provable.
 */
export default function ServiceHero({
  listingId,
  isSignedIn,
  bookingUrl,
  bookingText,
  inclusions,
  description,
}: {
  listingId: string
  isSignedIn: boolean
  bookingUrl: string | null
  bookingText: string | null
  inclusions: Spec[]
  description: string | null
}) {
  const model = serviceHeroModel({ bookingUrl, bookingText })

  return (
    <div data-testid="pdp-service-hero" style={{ marginBottom: 20 }}>
      {/* ── Schedule card (hero) ─────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
          <i className="iconoir-calendar" style={{ fontSize: 20, color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
          <div className="min-w-0">
            <p style={{ fontSize: 14, fontWeight: 800 }}>{model.scheduleHeading}</p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{model.scheduleNote}</p>
          </div>
        </div>
        {model.hasSchedule ? (
          <a
            href={bookingUrl!}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="pdp-service-agendar"
            className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
            style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
          >
            <i className="iconoir-calendar" style={{ fontSize: 16 }} />
            {model.primaryLabel}
          </a>
        ) : (
          <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label={model.primaryLabel} />
        )}
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label="Preguntar" variant="link" />
        </div>
      </div>

      {/* ── "Qué incluye" — service attrs + description ───────────────────────── */}
      {(inclusions.length > 0 || description) && (
        <div data-testid="pdp-service-incluye" style={{ background: 'var(--bg-sunk)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Qué incluye</h2>
          {inclusions.length > 0 && (
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginBottom: description ? 12 : 0 }}>
              {inclusions.map(spec => (
                <div key={spec.label} style={{ display: 'contents' }}>
                  <dt style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{spec.label}</dt>
                  <dd style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{spec.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {description && (
            <p style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{description}</p>
          )}
        </div>
      )}
    </div>
  )
}
