import Link from 'next/link'
import { eventHeroModel } from '@/lib/event-hero'
import type { ListingEventDetails } from '@/lib/event-listing'

/**
 * EventHero — PDP redesign (epic 01) Sprint 5, S5.3.
 *
 * For an event/boleto listing the page leads with this block: fecha · hora ·
 * lugar · dirección (from `readEventDetails`), then a light "¿Ya compraste? Ver
 * mi boleto" link to the buyer's order/ticket surface (which already renders the
 * QR). The buy CTA below is relabeled "Comprar boleto". Aforo / tiers / quantity
 * are deferred (no live source) and the inline QR is intentionally NOT resolved
 * here — see lib/event-hero.ts for the validation.
 *
 * Presentational Server Component — same info-card markup the legacy lower event
 * block used, promoted up so the event details lead the page.
 */
export default function EventHero({
  eventDetails,
}: {
  eventDetails: ListingEventDetails
}) {
  const model = eventHeroModel()

  return (
    <div data-testid="pdp-event-hero" style={{ marginBottom: 20 }}>
      <div style={{ background: 'var(--info-soft)', border: '1px solid var(--info)', borderRadius: 'var(--r-lg)', padding: '14px', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <i className="iconoir-calendar" style={{ fontSize: 20, color: 'var(--info)', marginTop: 1, flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--info)', marginBottom: 6 }}>Evento</p>
            {eventDetails.formatted_date && (
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>
                {eventDetails.formatted_date}
                {eventDetails.formatted_time && <span> · {eventDetails.formatted_time}</span>}
              </p>
            )}
            {eventDetails.venue_name && (
              <p style={{ fontSize: 13, color: 'var(--fg)', marginTop: 4 }}>{eventDetails.venue_name}</p>
            )}
            {eventDetails.venue_address && (
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{eventDetails.venue_address}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── "Ver mi boleto" — link to the order surface that renders the QR ───── */}
      <Link
        href={model.myTicketsHref}
        data-testid="pdp-event-my-ticket"
        className="inline-flex items-center gap-1 no-underline"
        style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-muted)', textDecoration: 'underline' }}
      >
        <i className="iconoir-qr-code" style={{ fontSize: 14 }} />
        ¿Ya compraste? Ver mi boleto
      </Link>
    </div>
  )
}
