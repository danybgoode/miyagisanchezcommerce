import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import AskSellerButton from '@/app/components/AskSellerButton'
import { autoHeroModel, repuveDisplay } from '@/lib/auto-hero'
import { financingDisplay, warrantyDisplay, inspectionDisplay } from '@/lib/auto-financing'
import type { Spec } from '@/lib/listing-attributes'

/**
 * AutoHero — PDP redesign (epic 01) Sprint 5, S5.1. Extended cars-vertical
 * S2.2 with financing/inspection/warranty trust surfaces.
 *
 * For an autos listing the page leads with this block: the "$X/mes" financing
 * hint (+ mandatory disclaimer) beside the price, the REPUVE verification
 * anchor (green "sin reporte" / red "con reporte" + folio), the inspection
 * report link + warranty chip, then the vehicle spec set (año · km ·
 * transmisión · combustible …), and a primary "Agendar prueba de manejo"
 * (links to the seller's calendar, or "Solicitar prueba de manejo" via a
 * conversation when there's none). The generic buy/offer bar stays below — a
 * car is buyable — so this is a reorder, not a takeover; the lower REPUVE
 * badge + generic specs table are suppressed for `autoLed` so nothing
 * duplicates. Every new S2.2 element is independently conditional — an absent
 * field renders nothing, so a listing with none of the new fields set is
 * byte-for-byte the pre-S2.2 hero.
 *
 * Presentational Server Component — the only client bit is the demoted
 * AskSellerButton. The decisions live in the pure `autoHeroModel`/
 * `repuveDisplay`/`financingDisplay`/`warrantyDisplay`/`inspectionDisplay`
 * seam so they're spec-provable.
 */
export default function AutoHero({
  listingId,
  isSignedIn,
  bookingUrl,
  repuve,
  specs,
  priceCents,
  attrs,
  marketBasePath = '',
}: {
  listingId: string
  isSignedIn: boolean
  bookingUrl: string | null
  repuve: { status?: string; folio?: string } | null | undefined
  specs: Spec[]
  priceCents: number | null | undefined
  attrs: Record<string, unknown>
  marketBasePath?: string
}) {
  const model = autoHeroModel({ bookingUrl })
  const rep = repuveDisplay(repuve)
  const financing = financingDisplay({ priceCents, downPaymentPct: attrs.financing_down_payment_pct, months: attrs.financing_months })
  const warranty = warrantyDisplay({ text: attrs.warranty_text, months: attrs.warranty_months })
  const inspection = inspectionDisplay({ url: attrs.inspection_report_url })

  return (
    <div data-testid="pdp-auto-hero" style={{ marginBottom: 20 }}>
      {/* ── Financing hint (S2.2) — "$X/mes" beside the price, disclaimer
          always underneath when it renders. ────────────────────────────────── */}
      {financing && (
        <div data-testid="pdp-auto-financing" style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 'var(--t-base)', fontWeight: 700 }}>{financing.monthlyLabel}</p>
          <p style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{financing.disclaimer}</p>
        </div>
      )}

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

      {/* ── Inspection report + warranty (S2.2) — "Ver reporte" opens the PDF
          in a new tab (no dead end, no in-page viewer); warranty is a plain
          chip alongside it. ─────────────────────────────────────────────────── */}
      {(inspection || warranty) && (
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
          {inspection && (
            <a
              href={inspection.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="pdp-auto-inspection"
              className="inline-flex items-center gap-1 no-underline"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', background: 'var(--success-soft)', borderRadius: 'var(--r-pill)', padding: '6px 10px' }}
            >
              <i className="iconoir-page-search" style={{ fontSize: 14 }} />
              <BuyerCopyText copyKey="l.id.AutoHero.5f2cd923" /></a>
          )}
          {warranty && (
            <span
              data-testid="pdp-auto-warranty"
              title={warranty.text ?? undefined}
              className="inline-flex items-center gap-1"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--info)', background: 'var(--info-soft)', borderRadius: 'var(--r-pill)', padding: '6px 10px' }}
            >
              <i className="iconoir-shield-check" style={{ fontSize: 14 }} />
              {warranty.chipLabel}
            </span>
          )}
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
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-[var(--r-md)] text-sm no-underline transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          <i className="iconoir-car" style={{ fontSize: 16 }} />
          {model.primaryLabel}
        </a>
      ) : (
        <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label={model.primaryLabel} marketBasePath={marketBasePath} />
      )}
    </div>
  )
}
