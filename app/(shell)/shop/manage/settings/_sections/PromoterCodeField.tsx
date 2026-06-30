'use client'

import { useState } from 'react'

/**
 * Promoter Program (epic 08, Sprint 1) — a promoter-code field + discount PREVIEW
 * for a paid-SKU checkout. Extracted from Canal.tsx so the section stays under the
 * anti-monolith line cap. Render it behind the `promoter.enabled` flag (resolved
 * server-side and passed into the section).
 *
 * On a valid code it shows "−$X · Pagarías $Y" before pay and fires a best-effort
 * enrollment attribution. No money moves here — the billed discount + cadence is
 * Sprint 2.
 */
export default function PromoterCodeField({
  priceCents,
  sku,
  onCodeChange,
}: {
  priceCents: number
  sku: string
  /** Sprint 2: lift the typed code up so the parent can bill the REAL one-time discount. */
  onCodeChange?: (code: string) => void
}) {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [discountCents, setDiscountCents] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const pesos = (cents: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

  async function preview() {
    const c = code.trim()
    setDiscountCents(null); setMsg(null)
    if (!c) return
    setChecking(true)
    try {
      const qs = new URLSearchParams({ code: c, itemsCents: String(priceCents) })
      const res = await fetch(`/api/promoter/validate-code?${qs}`)
      const data = await res.json().catch(() => null) as
        { valid?: boolean; discount_cents?: number; message?: string } | null
      if (data?.valid && typeof data.discount_cents === 'number') {
        setDiscountCents(data.discount_cents)
        // Best-effort: record the enrollment against the promoter (US-3). The server
        // resolves the seller's shop + dedupes; a failure must not block the UI.
        fetch('/api/promoter/attribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: c, sku }),
        }).catch(() => {})
      } else {
        setMsg(data?.message ?? 'Código de promotor no válido.')
      }
    } catch {
      setMsg('No se pudo validar el código. Intenta de nuevo.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="mb-3">
      <label className="block text-[11px] font-medium text-[var(--color-muted)] mb-1">
        ¿Te atendió un promotor?
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value); setDiscountCents(null); setMsg(null); onCodeChange?.(e.target.value) }}
          placeholder="Código de promotor (PRM-…)"
          autoCapitalize="characters"
          className="w-full sm:w-64 text-xs px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={preview}
          disabled={checking || !code.trim()}
          className="text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface)] disabled:opacity-50"
        >
          {checking ? 'Validando…' : 'Aplicar'}
        </button>
      </div>
      {discountCents !== null && (
        <p className="mt-1.5 text-xs text-[var(--color-accent)]" data-testid="promoter-discount-preview">
          Descuento de promotor: −{pesos(discountCents)} · Pagarías {pesos(Math.max(0, priceCents - discountCents))}
        </p>
      )}
      {msg && <p className="mt-1.5 text-xs text-red-600">⚠ {msg}</p>}
    </div>
  )
}
