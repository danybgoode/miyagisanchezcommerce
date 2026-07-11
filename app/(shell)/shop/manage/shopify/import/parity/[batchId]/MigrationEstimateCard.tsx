'use client'

import { useState } from 'react'

interface EstimateBreakdown {
  id: string
  listing_count: number
  base_price_cents: number
  overage_cents: number
  section_adder_cents: number
  total_price_cents: number
}

const mxn = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

/**
 * Client island — generates (or fetches the existing) quoted-estimate for a
 * batch above the flat 150-listing cap (epic 03 · platform-migrations S2 ·
 * US-2.2). Merchant-visible: shows the SAME itemized total a promoter's close
 * will charge — the server is the real guarantee (app/api/promoter/close/
 * migration refuses any amount that doesn't match this stored quote); this
 * card is purely informational/courtesy.
 */
export default function MigrationEstimateCard({ batchId }: { batchId: string }) {
  const [estimate, setEstimate] = useState<EstimateBreakdown | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/sell/shopify/import/parity/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'No se pudo generar la cotización.'); return }
      if (data.tier === 'estimate') setEstimate(data.estimate)
    } catch {
      setError('Error de red. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        padding: 16, borderRadius: 'var(--r-lg)', border: '1.5px solid var(--border)',
        background: 'var(--bg-elevated)', marginBottom: 20,
      }}
    >
      <h2 style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Cotización para tu catálogo</h2>
      <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 12 }}>
        Tu tienda tiene más de 150 productos — fuera del paquete de precio fijo. Este es el precio
        exacto que un consultor cobrará; es el mismo número que verá el consultor al cerrar la venta.
      </p>

      {!estimate && (
        <button
          onClick={generate}
          disabled={busy}
          style={{
            padding: '8px 16px', borderRadius: 'var(--r-md)', border: 'none',
            background: 'var(--accent)', color: 'var(--fg-inverse)', fontWeight: 600,
            fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Calculando…' : 'Generar cotización'}
        </button>
      )}

      {error && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>{error}</p>}

      {estimate && (
        <div style={{ fontSize: 14 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', marginBottom: 10 }}>
            <dt style={{ color: 'var(--fg-muted)' }}>Base (hasta 150 productos)</dt>
            <dd>{mxn(estimate.base_price_cents)}</dd>
            <dt style={{ color: 'var(--fg-muted)' }}>Excedente ({estimate.listing_count - 150} productos × $3)</dt>
            <dd>{mxn(estimate.overage_cents)}</dd>
            {estimate.section_adder_cents > 0 && (
              <>
                <dt style={{ color: 'var(--fg-muted)' }}>Secciones a la medida</dt>
                <dd>{mxn(estimate.section_adder_cents)}</dd>
              </>
            )}
          </dl>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
            <span>Total</span>
            <span>{mxn(estimate.total_price_cents)}</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 10 }}>
            ID de cotización (compártelo con tu consultor):{' '}
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{estimate.id}</span>
          </p>
        </div>
      )}
    </div>
  )
}
