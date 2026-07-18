'use client'

import { useState } from 'react'
import Link from 'next/link'
import AskSellerButton from '@/app/components/AskSellerButton'
import {
  computeRentalTotal,
  nightsBetween,
  rentalUnitsLabel,
  ratePeriodLabel,
  formatRentalCents,
  type RatePeriod,
} from '@/lib/rental-pricing'
import { resolveRentalBookingCta } from '@/lib/rental-booking-cta'

/**
 * RentalBooking — PDP redesign (epic 01) Sprint 4, S4.2; flag flip in Sprint 2
 * (epic 02 · rental-backend-line-item-pricing), Story 2.2.
 *
 * A rental leads with this date-range picker instead of the boxed buy/offer bar:
 * pick check-in / check-out → the EXACT total (`días × precio + depósito`) appears
 * beside the price. All the math is the pure `lib/rental-pricing.ts` seam, so the
 * displayed total is spec-proven exact.
 *
 * Behind `checkout.rental_pricing_enabled` (`rentalPricingEnabled` prop, read by
 * the PDP page): when ON and the seller has a payment method configured, "Reservar
 * estas fechas" deep-links straight to `/checkout` with the chosen dates — the
 * backend server-recomputes and charges the exact total shown here. When OFF (or
 * the seller has no payment method), the button opens an AskSeller conversation
 * instead, byte-for-byte as before. `resolveRentalBookingCta` (`lib/rental-booking-cta.ts`)
 * is the single decision point, so the flag-OFF regression is asserted directly
 * against that pure function. `booking_url` (if any) is a secondary availability link.
 */
export default function RentalBooking({
  listingId,
  dailyRateCents,
  depositCents,
  period,
  currency,
  isSignedIn,
  bookingUrl,
  rentalPricingEnabled,
  sellerHasPaymentMethod,
}: {
  listingId: string
  dailyRateCents: number
  depositCents: number
  period: RatePeriod
  currency: string
  isSignedIn: boolean
  bookingUrl: string | null
  /** `checkout.rental_pricing_enabled` — OFF keeps today's AskSeller flow. */
  rentalPricingEnabled: boolean
  /** Whether the seller has ≥1 online/selectable payment path configured. */
  sellerHasPaymentMethod: boolean
}) {
  // Today in Mexico City (not UTC) — a UTC `today` rolls to tomorrow after ~18:00
  // local (UTC-6), which would block a same-day check-in. en-CA renders YYYY-MM-DD.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')

  const nights = nightsBetween(checkIn, checkOut)
  const price = computeRentalTotal({ rateCents: dailyRateCents, depositCents, nights, period })
  const hasRange = price.units > 0
  const cta = resolveRentalBookingCta({ hasRange, rentalPricingEnabled, sellerHasPaymentMethod, listingId, checkIn, checkOut })

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

      {/* Primary action — checkout.rental_pricing_enabled ON + seller has a payment
          method: deep-link straight to checkout with these dates (the backend
          server-recomputes and charges the exact total shown above). Otherwise,
          byte-for-byte today's flow: open an AskSeller conversation to coordinate
          the reservation. `resolveRentalBookingCta` is the single decision point. */}
      {hasRange ? (
        <div data-testid="pdp-rental-reservar">
          {cta.mode === 'checkout' ? (
            <>
              <Link href={cta.href} className="btn btn-dark btn-lg" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
                <i className="iconoir-calendar-check" style={{ fontSize: 16 }} />
                Reservar estas fechas
              </Link>
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 6 }}>
                El depósito se cobra junto con la renta.
              </p>
            </>
          ) : (
            <>
              <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label="Reservar estas fechas" />
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 6 }}>
                Coordinarás el cobro y el depósito con el vendedor.
              </p>
            </>
          )}
        </div>
      ) : (
        <div
          role="button"
          aria-disabled="true"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-[var(--r-md)] text-sm"
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
