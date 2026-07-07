'use client'

/**
 * ConfiguratorBuyBox — the buy box for a print-configurator (multi-variant,
 * tiered-price) listing (custom-print-products epic, Sprint 2 Story 2.3):
 * one <select> per option dimension (Tamaño / Material / Acabado) + a
 * quantity stepper + a live price derived from the price-grid fetched once
 * server-side (`lib/price-grid.ts`'s pure resolver — no per-keystroke network
 * call).
 *
 * Sprint 3 (Story 3.4) added: any custom fields the listing also has —
 * chiefly the `file` artwork-upload field — render via the same
 * `<PersonalizationFields>`/`proceed()` pattern `PersonalizationBuyBox` uses
 * for a flat-price personalizable product. The CTA validates BOTH the
 * variant/tier selection AND any required custom fields before stashing the
 * payload and navigating to /checkout (no more plain, ungated `<Link>`).
 * Negotiation/offers still don't compose with this buy box (Daniel-confirmed
 * Sprint 2 scope call, unaffected by Sprint 3).
 */

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
import {
  type PriceGrid,
  resolveVariantForOptions,
  resolveTierForQuantity,
  formatPriceGridAmount,
} from '@/lib/price-grid'
import {
  type CustomFieldDef,
  buildPersonalizationPayload,
  validatePersonalization,
  stashPersonalization,
  parseSizeCm,
} from '@/lib/personalization'
import PersonalizationFields, { type PersonalizationFieldsHandle } from '@/app/components/PersonalizationFields'

export default function ConfiguratorBuyBox({
  listingId,
  priceGrid,
  isSignedIn,
  customDomain,
  currency,
  customFields = [],
}: {
  listingId: string
  priceGrid: PriceGrid
  isSignedIn: boolean
  customDomain: string | null
  currency: string
  customFields?: CustomFieldDef[]
}) {
  const router = useRouter()
  const fieldsRef = useRef<PersonalizationFieldsHandle>(null)

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
  const [values, setValues] = useState<Record<string, string>>({})
  const [invalidFieldId, setInvalidFieldId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const variant = resolveVariantForOptions(priceGrid, selected)
  const tier = variant ? resolveTierForQuantity(variant.tiers, qty) : null
  const unitCents = tier?.amount ?? null
  const totalCents = unitCents != null ? unitCents * Math.max(1, qty) : null
  const canBuy = !!variant && unitCents != null

  // Best-effort physical size (cm) from whichever selected dimension value
  // parses — feeds the low-res artwork preflight (S3.3); silently absent for
  // a listing with no size-like dimension (no preflight, never confuses).
  const physicalCm = useMemo(() => {
    for (const v of Object.values(selected)) {
      const cm = parseSizeCm(v)
      if (cm) return cm
    }
    return null
  }, [selected])

  function onFieldChange(id: string, value: string) {
    setValues(prev => ({ ...prev, [id]: value }))
    if (invalidFieldId === id && value.trim()) setInvalidFieldId(null)
  }

  function proceed() {
    if (!canBuy) return
    const check = validatePersonalization(customFields, values)
    if (!check.ok) {
      setInvalidFieldId(check.missingFieldId ?? null)
      if (check.missingFieldId) fieldsRef.current?.focusField(check.missingFieldId)
      return
    }
    setLoading(true)
    stashPersonalization(listingId, buildPersonalizationPayload(customFields, values))
    const path = variant
      ? `/checkout?listingId=${encodeURIComponent(listingId)}&variantId=${encodeURIComponent(variant.id)}&qty=${qty}`
      : `/checkout?listingId=${listingId}`
    if (isSignedIn) {
      const href = checkoutHopHref(path, customDomain)
      if (customDomain) window.location.href = href
      else router.push(href)
    } else {
      window.location.href = signInHopHref(path, customDomain)
    }
  }

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
      {/* Skip the dimension selector entirely for a single-variant listing
          that only has quantity tiers (nothing to choose — the sole variant
          always resolves) — just the qty stepper + live tier price below. */}
      {priceGrid.variants.length > 1 && dimensions.map((dim) => (
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

      {customFields.length > 0 && (
        <PersonalizationFields
          ref={fieldsRef}
          defs={customFields}
          values={values}
          onChange={onFieldChange}
          invalidFieldId={invalidFieldId}
          listingId={listingId}
          physicalCm={physicalCm}
        />
      )}

      {canBuy ? (
        <button
          type="button"
          onClick={proceed}
          disabled={loading}
          data-testid="configurator-buy-cta"
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          {loading ? (
            <span className="animate-spin inline-block">⟳</span>
          ) : isSignedIn ? (
            `Comprar ahora — ${formatPriceGridAmount(totalCents!, currency)}`
          ) : (
            'Inicia sesión para comprar'
          )}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', padding: '0 8px' }}>
          Selecciona una combinación disponible
        </div>
      )}
    </div>
  )
}
