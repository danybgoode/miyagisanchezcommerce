'use client'

import { useState } from 'react'
import AskSellerButton from '@/app/components/AskSellerButton'
import {
  computeRentalTotal,
  nightsBetween,
  rentalUnitsLabel,
  ratePeriodLabel,
  formatRentalCents,
  type RatePeriod,
} from '@/lib/rental-pricing'

/**
 * RentalBooking — PDP redesign (epic 01) Sprint 4, S4.2.
 *
 * A rental leads with this date-range picker instead of the boxed buy/offer bar:
 * pick check-in / check-out → the EXACT total (`días × precio + depósito`) appears
 * beside the price as an ESTIMATE. The deposit is shown up front, before any date
 * is picked. All the math is the pure `lib/rental-pricing.ts` seam, so the
 * displayed estimate is spec-proven exact.
 *
 * No money mutation: a rental is fulfilled by coordination (fulfillment = coord),
 * and the generic /checkout charges a single unit of `price_cents` — it does NOT
 * honor the date range or deposit — so "Reservar estas fechas" opens a conversation
 * with the seller to confirm dates, the total, and the deposit/payment, rather than
 * sending the buyer to a checkout that would contradict the shown total.
 * `booking_url` (if any) is a secondary availability link.
 */
export default function RentalBooking({
  listingId,
  dailyRateCents,
  depositCents,
  period,
  currency,
  isSignedIn,
  bookingUrl,
}: {
  listingId: string
  dailyRateCents: number
  depositCents: number
  period: RatePeriod
  currency: string
  isSignedIn: boolean
  bookingUrl: string | null
}) {
  // Today in Mexico City (not UTC) — a UTC `today` rolls to tomorrow after ~18:00
  // local (UTC-6), which would block a same-day check-in. en-CA renders YYYY-MM-DD.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')

  const nights = nightsBetween(checkIn, checkOut)
  const price = computeRentalTotal({ rateCents: dailyRateCents, depositCents, nights, period })
  const hasRange = price.units > 0

  return (
    <div data-testid="pdp-rental-booking" style={{ marginBottom: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
        <i className="iconoir-calendar" style={{ fontSize: 20, color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
        <div className="min-w-0">
          <p style={{ fontSize: 14, fontWeight: 800 }}>Elige tus fechas</p>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
            {formatRentalCents(dailyRateCents, currency)} / {ratePeriodLabel(period)}
            {depositCents > 0 && <> · depósito {formatRentalCents(depositCents, currency)}</>}
          </p>
        </div>
      </div>

      {/* Date range */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)' }}>Entrada</span>
          <input
            type="date"
            data-testid="pdp-rental-checkin"
            value={checkIn}
            min={today}
            onChange={e => {
              setCheckIn(e.target.value)
              if (checkOut && e.target.value && checkOut <= e.target.value) setCheckOut('')
            }}
            style={{ width: '100%', marginTop: 4, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 10px', fontSize: 13, background: 'var(--bg)' }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)' }}>Salida</span>
          <input
            type="date"
            data-testid="pdp-rental-checkout"
            value={checkOut}
            min={checkIn || today}
            onChange={e => setCheckOut(e.target.value)}
            style={{ width: '100%', marginTop: 4, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 10px', fontSize: 13, background: 'var(--bg)' }}
          />
        </label>
      </div>

      {/* Breakdown — exact total */}
      {hasRange && (
        <div data-testid="pdp-rental-breakdown" style={{ background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', padding: 12, marginBottom: 14, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--fg-muted)' }}>
              {formatRentalCents(dailyRateCents, currency)} × {rentalUnitsLabel(price.units, period)}
            </span>
            <span style={{ fontWeight: 600 }}>{formatRentalCents(price.rentCents, currency)}</span>
          </div>
          {price.depositCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Depósito reembolsable</span>
              <span style={{ fontWeight: 600 }}>{formatRentalCents(price.depositCents, currency)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
            <span style={{ fontWeight: 700 }}>Total estimado</span>
            <span data-testid="pdp-rental-total" style={{ fontWeight: 800 }}>{formatRentalCents(price.totalCents, currency)}</span>
          </div>
        </div>
      )}

      {/* Primary action — coordinate the reservation with the seller (a rental is
          fulfilled by coordination; the generic checkout would mischarge a single
          unit and ignore the deposit, so we don't send the buyer there). */}
      {hasRange ? (
        <div data-testid="pdp-rental-reservar">
          <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label="Reservar estas fechas" />
          <p style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 6 }}>
            Coordinarás el cobro y el depósito con el vendedor.
          </p>
        </div>
      ) : (
        <div
          role="button"
          aria-disabled="true"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm"
          style={{ background: 'var(--bg-sunk)', color: 'var(--fg-subtle)', cursor: 'not-allowed' }}
        >
          Elige fechas para reservar
        </div>
      )}

      {bookingUrl && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'underline' }}>
            Ver disponibilidad
          </a>
        </div>
      )}
    </div>
  )
}
