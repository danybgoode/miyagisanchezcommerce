import AskSellerButton from '@/app/components/AskSellerButton'
import { autoHeroModel, repuveDisplay } from '@/lib/auto-hero'
import type { Spec } from '@/lib/listing-attributes'

/**
 * AutoHero — PDP redesign (epic 01) Sprint 5, S5.1.
 *
 * For an autos listing the page leads with this block: the REPUVE verification
 * anchor (green "sin reporte" / red "con reporte" + folio) directly under the
 * price, then the vehicle spec set (año · km · transmisión · combustible …), and
 * a primary "Agendar prueba de manejo" (links to the seller's calendar, or
 * "Solicitar prueba de manejo" via a conversation when there's none). The generic
 * buy/offer bar stays below — a car is buyable — so this is a reorder, not a
 * takeover; the lower REPUVE badge + generic specs table are suppressed for
 * `autoLed` so nothing duplicates.
 *
 * Presentational Server Component — the only client bit is the demoted
 * AskSellerButton. The decision lives in the pure `autoHeroModel`/`repuveDisplay`
 * seam so it's spec-provable.
 */
export default function AutoHero({
  listingId,
  isSignedIn,
  bookingUrl,
  repuve,
  specs,
}: {
  listingId: string
  isSignedIn: boolean
  bookingUrl: string | null
  repuve: { status?: string; folio?: string } | null | undefined
  specs: Spec[]
}) {
  const model = autoHeroModel({ bookingUrl })
  const rep = repuveDisplay(repuve)

  return (
    <div data-testid="pdp-auto-hero" style={{ marginBottom: 20 }}>
      {/* ── REPUVE verification anchor (hero) ────────────────────────────────── */}
      {rep && (
        <div
          data-testid="pdp-auto-repuve"
          className="flex items-center gap-2"
          style={{ background: rep.clean ? 'var(--success-soft)' : 'var(--danger-soft)', borderRadius: 'var(--r-md)', padding: '12px 14px', marginBottom: 12 }}
        >
          <i className={rep.icon} style={{ fontSize: 20, color: rep.clean ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: rep.clean ? 'var(--success)' : 'var(--danger)' }}>{rep.label}</span>
            {rep.folioLabel && <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{rep.folioLabel}</span>}
          </div>
        </div>
      )}

      {/* ── Vehicle specs ────────────────────────────────────────────────────── */}
      {specs.length > 0 && (
        <dl data-testid="pdp-auto-specs" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', background: 'var(--bg-sunk)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 16 }}>
          {specs.map(spec => (
            <div key={spec.label} style={{ display: 'contents' }}>
              <dt style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{spec.label}</dt>
              <dd style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{spec.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* ── Primary action: test drive ───────────────────────────────────────── */}
      {model.hasSchedule ? (
        <a
          href={bookingUrl!}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="pdp-auto-agendar"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          <i className="iconoir-car" style={{ fontSize: 16 }} />
          {model.primaryLabel}
        </a>
      ) : (
        <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label={model.primaryLabel} />
      )}
    </div>
  )
}
