'use client'

import { useEffect, useState } from 'react'
import { formatCents, formatPct, solveForPrice, type SkuMarginRow } from '@/lib/profit'

/**
 * Per-SKU target-margin control + one-click Apply (profit-analyzer S2 ·
 * US-5). Fetches the ML fee rate ONCE per card at mount (not per slider
 * tick) — the slider recomputes `solveForPrice` locally from there for
 * instant feedback. That cached rate was fetched AT THE ROW'S AVERAGE
 * PRICE though, and a materially different candidate price could sit in a
 * different ML fee bracket — so clicking Apply re-fetches the rate ONE more
 * time, at the actual candidate price, before showing the confirm dialog
 * (`startConfirm`), and it's that freshly-verified price that gets applied.
 * "Precio actual" is the row's realized average unit price (revenue /
 * units) — the ledger has no live catalog-price read, so this is a labeled
 * approximation, not the literal current PDP price.
 */

type FeeEstimate = { available: boolean; feePct?: number; fixedFeeCents?: number }
type ApplyResult =
  | { miyagi: 'ok'; ml: 'ok'; action?: string }
  | { miyagi: 'ok'; ml: 'skipped' }
  | { miyagi: 'ok'; ml: 'failed'; ml_reason?: string }
  | { miyagi: 'failed'; message?: string }
  | { error: string }

const DEFAULT_TARGET_MARGIN_PCT = 25

function ConfirmApplyDialog({
  row, currentPriceCents, newPriceCents, targetMarginPct, pending, onConfirm, onCancel,
}: {
  row: SkuMarginRow
  currentPriceCents: number
  newPriceCents: number
  targetMarginPct: number
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal>
      <div className="bg-[var(--fg-inverse)] rounded-[var(--r-md)] shadow-xl w-full max-w-sm p-6">
        <h2 className="font-bold text-base mb-2">¿Aplicar nuevo precio?</h2>
        <p className="text-sm text-[var(--color-muted)] mb-1">
          <strong>{row.title}</strong>
        </p>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          {formatCents(currentPriceCents)} → <strong className="text-[var(--color-text)]">{formatCents(newPriceCents)}</strong>
          {' '}· margen objetivo {targetMarginPct}%
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} disabled={pending} className="px-4 py-2 text-sm rounded-[var(--r-md)] border border-[var(--color-border)]">
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="px-4 py-2 text-sm rounded-[var(--r-md)] bg-[var(--color-accent)] text-white font-medium disabled:opacity-60"
          >
            {pending ? 'Aplicando…' : 'Sí, aplicar'}
          </button>
        </div>
      </div>
    </div>
  )
}

async function fetchFeeEstimate(productId: string, priceCents: number): Promise<FeeEstimate> {
  try {
    const res = await fetch(`/api/sell/profit/fee-estimate?product_id=${encodeURIComponent(productId)}&price_cents=${priceCents}`)
    if (!res.ok) return { available: false }
    return (await res.json()) as FeeEstimate
  } catch {
    return { available: false }
  }
}

export default function PricingCard({ row }: { row: SkuMarginRow }) {
  const [targetMarginPct, setTargetMarginPct] = useState(DEFAULT_TARGET_MARGIN_PCT)
  const [fee, setFee] = useState<FeeEstimate | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [confirmPriceCents, setConfirmPriceCents] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const currentPriceCents = row.units > 0 ? Math.round(row.revenue_cents / row.units) : 0
  const costPerUnitCents = row.units > 0 ? Math.round(row.cogs_cents / row.units) : 0

  useEffect(() => {
    if (!row.variant_id || currentPriceCents <= 0) return
    let cancelled = false
    fetchFeeEstimate(row.product_id, currentPriceCents).then((d) => { if (!cancelled) setFee(d) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.product_id, row.variant_id])

  if (!row.variant_id || currentPriceCents <= 0) return null // nothing addressable to price

  const feePct = fee?.available ? (fee.feePct ?? 0) : 0
  const fixedFeeCents = fee?.available ? (fee.fixedFeeCents ?? 0) : 0
  const solved = solveForPrice({
    cogsCents: costPerUnitCents,
    shippingCents: 0, // per-SKU rows exclude shipping (order-level cost)
    fixedFeeCents,
    feePct,
    targetMarginPct: targetMarginPct / 100,
  })

  // The card's cached fee rate was fetched at the row's realized average
  // price — a price bracket ML quotes a materially different fee at (a low-
  // price fixed-fee threshold, say) would make that estimate stale for a
  // very different candidate price. Re-check the rate AT THE CANDIDATE PRICE
  // right before confirming, so the number the seller actually applies is
  // freshly validated, not the live-slider preview.
  async function startConfirm() {
    if (!solved.achievable) return
    setVerifying(true)
    setResult(null)
    try {
      const freshFee = await fetchFeeEstimate(row.product_id, solved.priceCents)
      const freshSolved = solveForPrice({
        cogsCents: costPerUnitCents,
        shippingCents: 0,
        fixedFeeCents: freshFee.available ? (freshFee.fixedFeeCents ?? 0) : 0,
        feePct: freshFee.available ? (freshFee.feePct ?? 0) : 0,
        targetMarginPct: targetMarginPct / 100,
      })
      if (!freshSolved.achievable) {
        setResult({ error: 'La comisión verificada ya no permite ese margen. Ajusta el control e intenta de nuevo.' })
        return
      }
      setConfirmPriceCents(freshSolved.priceCents)
    } finally {
      setVerifying(false)
    }
  }

  async function apply() {
    if (confirmPriceCents == null) return
    setPending(true)
    setResult(null)
    try {
      const res = await fetch('/api/sell/profit/apply-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: row.product_id,
          variant_id: row.variant_id,
          new_price_cents: confirmPriceCents,
          target_margin_pct: targetMarginPct / 100,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setResult({ error: d.error ?? d.message ?? 'No se pudo aplicar el precio.' })
      } else {
        setResult(d)
      }
    } catch {
      setResult({ error: 'No se pudo aplicar el precio. Intenta de nuevo.' })
    } finally {
      setPending(false)
      setConfirmPriceCents(null)
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[var(--r-md)] p-4">
      <p className="text-sm font-medium text-[var(--color-text)] truncate">{row.title}</p>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Precio actual (promedio reciente): {formatCents(currentPriceCents)}
        {fee && !fee.available && ' · comisión ML no disponible, estimando sin ella'}
      </p>

      <label className="text-xs text-[var(--color-muted)] block mb-1">
        Margen objetivo: <strong className="text-[var(--color-text)]">{targetMarginPct}%</strong>
      </label>
      <input
        type="range"
        min={0}
        max={90}
        step={1}
        value={targetMarginPct}
        onChange={(e) => setTargetMarginPct(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />

      <div className="mt-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--color-muted)]">Precio sugerido</p>
          {solved.achievable ? (
            <p className="text-lg font-bold text-[var(--color-text)]">{formatCents(solved.priceCents)}</p>
          ) : (
            <p className="text-sm text-amber-700">No hay precio posible con ese margen y comisión</p>
          )}
        </div>
        <button
          onClick={startConfirm}
          disabled={!solved.achievable || pending || verifying}
          className="px-4 py-2 text-sm rounded-[var(--r-md)] bg-[var(--color-accent)] text-white font-medium disabled:opacity-40"
        >
          {verifying ? 'Verificando…' : 'Aplicar'}
        </button>
      </div>

      {result && (
        <p className={`text-xs mt-2 ${'error' in result || result.miyagi === 'failed' || (result.miyagi === 'ok' && 'ml' in result && result.ml === 'failed') ? 'text-red-600' : 'text-green-700'}`}>
          {'error' in result && result.error}
          {'miyagi' in result && result.miyagi === 'failed' && (result.message ?? 'No se pudo actualizar el precio.')}
          {'miyagi' in result && result.miyagi === 'ok' && 'ml' in result && result.ml === 'ok' && 'Precio actualizado en Miyagi y en Mercado Libre.'}
          {'miyagi' in result && result.miyagi === 'ok' && 'ml' in result && result.ml === 'skipped' && 'Precio actualizado en Miyagi (sin publicación en Mercado Libre).'}
          {'miyagi' in result && result.miyagi === 'ok' && 'ml' in result && result.ml === 'failed' && (
            `Precio actualizado en Miyagi. No se pudo actualizar en Mercado Libre: ${result.ml_reason ?? 'error desconocido'}`
          )}
        </p>
      )}

      {confirmPriceCents != null && (
        <ConfirmApplyDialog
          row={row}
          currentPriceCents={currentPriceCents}
          newPriceCents={confirmPriceCents}
          targetMarginPct={targetMarginPct}
          pending={pending}
          onConfirm={apply}
          onCancel={() => setConfirmPriceCents(null)}
        />
      )}
    </div>
  )
}
