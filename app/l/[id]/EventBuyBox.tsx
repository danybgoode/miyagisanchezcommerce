'use client'

/**
 * EventBuyBox — the quantity stepper + buy CTA for paid event admissions
 * (epic 10, S1.2). Renders only when `events.quantity_enabled` is ON and the
 * event has > 1 seat left (the PDP passes `cap`); otherwise the page keeps the
 * plain single-ticket <Link> unchanged.
 *
 * The stepper is clamped to `[1, cap]` (cap = remaining aforo). `qty` rides the
 * checkout link as `&qty=N`; the backend issuance loop mints one ticket per unit.
 * Signed-out buyers still pick a quantity — it's carried through the sign-in hop.
 */

import { useState } from 'react'
import Link from 'next/link'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
import { ticketTotalLabel } from '@/lib/ticket-quantity'

export default function EventBuyBox({
  listingId,
  unitCents,
  currency,
  cap,
  isSignedIn,
  customDomain,
  buyLabelPrefix,
  signInLabel,
}: {
  listingId: string
  unitCents: number
  currency: string
  cap: number
  isSignedIn: boolean
  customDomain: string | null
  buyLabelPrefix: string
  signInLabel: string
}) {
  const max = Math.max(1, cap)
  const [qty, setQty] = useState(1)

  const path = `/checkout?listingId=${listingId}&qty=${qty}`
  const href = isSignedIn ? checkoutHopHref(path, customDomain) : signInHopHref(path, customDomain)
  const label = isSignedIn ? `${buyLabelPrefix} — ${ticketTotalLabel(unitCents, qty, currency)}` : signInLabel

  const stepBtn: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1.5px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--fg)',
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Boletos</span>
        <div role="group" aria-label="Cantidad de boletos" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setQty(q => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Quitar un boleto"
            style={{ ...stepBtn, opacity: qty <= 1 ? 0.4 : 1, cursor: qty <= 1 ? 'not-allowed' : 'pointer' }}
          >
            −
          </button>
          <span data-testid="ticket-qty" style={{ minWidth: 24, textAlign: 'center', fontSize: 16, fontWeight: 800 }}>
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty(q => Math.min(max, q + 1))}
            disabled={qty >= max}
            aria-label="Agregar un boleto"
            style={{ ...stepBtn, opacity: qty >= max ? 0.4 : 1, cursor: qty >= max ? 'not-allowed' : 'pointer' }}
          >
            +
          </button>
        </div>
      </div>
      <Link
        href={href}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
        style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
      >
        {label}
      </Link>
    </div>
  )
}
