'use client'

import { useState } from 'react'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
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
 * beside the price and on the primary "Reservar · $total" action. The deposit is
 * shown up front, before any date is picked. All the math is the pure
 * `lib/rental-pricing.ts` seam, so the displayed totals are spec-proven exact.
 *
 * No money mutation: "Reservar" reuses the existing checkout hop, carrying the
 * chosen dates as context; `booking_url` (if any) is a secondary availability link.
 */
export default function RentalBooking({
  listingId,
  dailyRateCents,
  depositCents,
  period,
  currency,
  isSignedIn,
  customDomain,
  bookingUrl,
}: {
  listingId: string
  dailyRateCents: number
  depositCents: number
  period: RatePeriod
  currency: string
  isSignedIn: boolean
  customDomain: string | null
  bookingUrl: string | null
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')

  const nights = nightsBetween(checkIn, checkOut)
  const price = computeRentalTotal({ rateCents: dailyRateCents, depositCents, nights, period })
  const hasRange = price.units > 0

  const reservePath = `/checkout?listingId=${listingId}${checkIn ? `&checkin=${checkIn}` : ''}${checkOut ? `&checkout=${checkOut}` : ''}`
  const reserveHref = isSignedIn ? checkoutHopHref(reservePath, customDomain) : signInHopHref(reservePath, customDomain)

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
            <span style={{ fontWeight: 700 }}>Total</span>
            <span data-testid="pdp-rental-total" style={{ fontWeight: 800 }}>{formatRentalCents(price.totalCents, currency)}</span>
          </div>
        </div>
      )}

      {/* Primary action */}
      {hasRange ? (
        <a
          href={reserveHref}
          data-testid="pdp-rental-reservar"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          Reservar · {formatRentalCents(price.totalCents, currency)}
        </a>
      ) : (
        <div
          aria-disabled
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
