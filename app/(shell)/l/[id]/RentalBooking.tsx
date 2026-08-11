'use client'

import { BuyerCopyText, useBuyerFormatters } from '@/app/components/BuyerPresentationContext'
import { useState } from 'react'
import Link from 'next/link'
import AskSellerButton from '@/app/components/AskSellerButton'
import {
  computeRentalTotal,
  nightsBetween,
  rentalUnitsLabel,
  ratePeriodLabel,
  type RatePeriod,
} from '@/lib/rental-pricing'
import { resolveRentalBookingCta } from '@/lib/rental-booking-cta'
import { presentationCalendarDate } from '@/lib/market-presentation'

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
  marketBasePath = '',
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
  marketBasePath?: string
}) {
  const formatters = useBuyerFormatters()
  const formatCents = (cents: number) => formatters.currency(cents, currency, { maximumFractionDigits: 0 })
  // Native date inputs require YYYY-MM-DD, evaluated in the route-owned market
  // timezone so a UTC rollover never blocks a valid same-day booking.
  const today = presentationCalendarDate(formatters.presentation, new Date())
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
          <p style={{ fontSize: 14, fontWeight: 800 }}><BuyerCopyText copyKey="l.id.RentalBooking.f4eff161" /></p>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
            {formatCents(dailyRateCents)} / {ratePeriodLabel(period)}
            {depositCents > 0 && <> <BuyerCopyText copyKey="l.id.RentalBooking.9587ef43" />{' '}{formatCents(depositCents)}</>}
          </p>
        </div>
      </div>

      {/* Date range */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)' }}><BuyerCopyText copyKey="l.id.RentalBooking.d5250dea" /></span>
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
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)' }}><BuyerCopyText copyKey="l.id.RentalBooking.3e39719e" /></span>
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
              {formatCents(dailyRateCents)} × {rentalUnitsLabel(price.units, period)}
            </span>
            <span style={{ fontWeight: 600 }}>{formatCents(price.rentCents)}</span>
          </div>
          {price.depositCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--fg-muted)' }}><BuyerCopyText copyKey="l.id.RentalBooking.cec46bd7" /></span>
              <span style={{ fontWeight: 600 }}>{formatCents(price.depositCents)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
            <span style={{ fontWeight: 700 }}><BuyerCopyText copyKey="l.id.RentalBooking.de76d847" /></span>
            <span data-testid="pdp-rental-total" style={{ fontWeight: 800 }}>{formatCents(price.totalCents)}</span>
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
                <BuyerCopyText copyKey="l.id.RentalBooking.7b1ec463" /></Link>
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 6 }}>
                <BuyerCopyText copyKey="l.id.RentalBooking.e6cac2b2" /></p>
            </>
          ) : (
            <>
              <AskSellerButton listingId={listingId} isSignedIn={isSignedIn} label="Reservar estas fechas" marketBasePath={marketBasePath} />
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 6 }}>
                <BuyerCopyText copyKey="l.id.RentalBooking.17e79e6e" /></p>
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
          <BuyerCopyText copyKey="l.id.RentalBooking.c8f49c5f" /></div>
      )}

      {bookingUrl && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'underline' }}>
            <BuyerCopyText copyKey="l.id.RentalBooking.efe56842" /></a>
        </div>
      )}
    </div>
  )
}
