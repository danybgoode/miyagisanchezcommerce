'use client'

/**
 * ConfiguratorBuyBox — the buy box for a print-configurator (multi-variant,
 * tiered-price) listing (custom-print-products epic, Sprint 2 Story 2.3):
 * one <select> per option dimension (Tamaño / Material / Acabado) + a
 * quantity stepper + a live price derived from the price-grid fetched once
 * server-side (`lib/price-grid.ts`'s pure resolver — no per-keystroke network
 * call). Navigates to /checkout with the resolved variantId + qty; the
 * checkout page re-resolves the same tier-correct price server-side so the
 * pay-button total always equals the summary.
 *
 * Negotiation/offers and personalization don't compose with this buy box
 * this sprint (Daniel-confirmed scope call) — a configurator listing is
 * cash/card-only, no in-chat offers.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
import {
  type PriceGrid,
  resolveVariantForOptions,
  resolveTierForQuantity,
  formatPriceGridAmount,
} from '@/lib/price-grid'

export default function ConfiguratorBuyBox({
  listingId,
  priceGrid,
  isSignedIn,
  customDomain,
  currency,
}: {
  listingId: string
  priceGrid: PriceGrid
  isSignedIn: boolean
  customDomain: string | null
  currency: string
}) {
  // One dimension title → its available values, in first-seen order.
  const dimensions = useMemo(() => {
    const order: string[] = []
    const values: Record<string, Set<string>> = {}
    for (const v of priceGrid.variants) {
      for (const [title, value] of Object.entries(v.options)) {
        if (!values[title]) {
          values[title] = new Set()
          order.push(title)
        }
        values[title].add(value)
      }
    }
    return order.map((title) => ({ title, values: Array.from(values[title]) }))
  }, [priceGrid])

  const [selected, setSelected] = useState<Record<string, string>>(() => ({
    ...(priceGrid.variants[0]?.options ?? {}),
  }))
  const [qty, setQty] = useState(1)

  const variant = resolveVariantForOptions(priceGrid, selected)
  const tier = variant ? resolveTierForQuantity(variant.tiers, qty) : null
  const unitCents = tier?.amount ?? null
  const totalCents = unitCents != null ? unitCents * Math.max(1, qty) : null
  const canBuy = !!variant && unitCents != null

  const path = variant
    ? `/checkout?listingId=${encodeURIComponent(listingId)}&variantId=${encodeURIComponent(variant.id)}&qty=${qty}`
    : `/checkout?listingId=${listingId}`
  const href = isSignedIn ? checkoutHopHref(path, customDomain) : signInHopHref(path, customDomain)

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
  const labelStyle: React.CSSProperties = { fontSize: 13, color: 'var(--fg-muted)' }
  const selectStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1.5px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--fg)',
    fontSize: 14,
  }
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {dimensions.map((dim) => (
        <div key={dim.title} style={rowStyle}>
          <span style={labelStyle}>{dim.title}</span>
          <select
            value={selected[dim.title] ?? ''}
            onChange={(e) => setSelected((prev) => ({ ...prev, [dim.title]: e.target.value }))}
            style={selectStyle}
            aria-label={dim.title}
          >
            {dim.values.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      ))}

      <div style={rowStyle}>
        <span style={labelStyle}>Cantidad</span>
        <div role="group" aria-label="Cantidad" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Restar"
            style={{ ...stepBtn, opacity: qty <= 1 ? 0.4 : 1, cursor: qty <= 1 ? 'not-allowed' : 'pointer' }}
          >
            −
          </button>
          <span data-testid="configurator-qty" style={{ minWidth: 32, textAlign: 'center', fontSize: 16, fontWeight: 800 }}>
            {qty}
          </span>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Sumar" style={stepBtn}>
            +
          </button>
        </div>
      </div>

      {unitCents != null && (
        <p style={{ fontSize: 12, color: 'var(--fg-muted)', textAlign: 'right' }}>
          {formatPriceGridAmount(unitCents, currency)} c/u
        </p>
      )}

      {canBuy ? (
        <Link
          href={href}
          data-testid="configurator-buy-cta"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          {isSignedIn ? `Comprar ahora — ${formatPriceGridAmount(totalCents!, currency)}` : 'Inicia sesión para comprar'}
        </Link>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', padding: '0 8px' }}>
          Selecciona una combinación disponible
        </div>
      )}
    </div>
  )
}
