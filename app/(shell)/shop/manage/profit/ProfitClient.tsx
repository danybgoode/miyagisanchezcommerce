'use client'

import { SellerBreadcrumb } from '../SellerBreadcrumb'
import {
  formatCents,
  formatPct,
  type OrderMarginRow,
  type SkuMarginRow,
  type PendingPiece,
} from '@/lib/profit'

/**
 * Profit dashboard v1 (profit-analyzer S1 · US-3) — presentational only; all
 * math lives in the pure `lib/profit.ts` seam the server page already ran.
 * Partial rows render honestly ("envío pendiente" etc.), never as $0-complete.
 * ML-fee column is entitlement-gated (`showMlFees`, ml_sync SKU).
 */

const PENDING_LABEL: Record<PendingPiece, string> = {
  cogs: 'costo pendiente',
  shipping: 'envío pendiente',
  ml_fee: 'comisión ML pendiente',
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'
}

function MarginCell({ cents, pct }: { cents: number; pct: number | null }) {
  const negative = cents < 0
  return (
    <span className={negative ? 'text-red-600 font-semibold' : 'text-green-700 font-semibold'}>
      {formatCents(cents)}
      <span className="text-xs font-normal text-[var(--color-muted)]"> · {formatPct(pct)}</span>
    </span>
  )
}

export default function ProfitClient({
  orderRows,
  skuRows,
  showMlFees,
  loadFailed,
}: {
  orderRows: OrderMarginRow[]
  skuRows: SkuMarginRow[]
  showMlFees: boolean
  loadFailed: boolean
}) {
  const totals = orderRows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue_cents,
      fees: acc.fees + r.fees_cents,
      shipping: acc.shipping + r.shipping_cents,
      cogs: acc.cogs + r.cogs_cents,
      margin: acc.margin + r.margin_cents,
    }),
    { revenue: 0, fees: 0, shipping: 0, cogs: 0, margin: 0 },
  )
  const totalPct = totals.revenue > 0 ? totals.margin / totals.revenue : null

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <SellerBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Ganancias</h1>
        <p className="text-[var(--color-muted)] text-sm mt-1">
          Lo que ganas de verdad en cada venta — ingresos menos comisiones, envío y tu costo,
          congelados al momento de la venta.
        </p>
      </div>

      {loadFailed && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
          No se pudieron cargar tus datos de ganancias. Recarga la página para intentarlo de nuevo.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">Ingresos</p>
          <p className="text-xl font-bold text-[var(--color-text)] mt-1">{formatCents(totals.revenue)}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{orderRows.length} ventas</p>
        </div>
        {showMlFees && (
          <div className="border border-[var(--color-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--color-muted)] font-medium">Comisiones ML</p>
            <p className="text-xl font-bold text-[var(--color-text)] mt-1">{formatCents(totals.fees)}</p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">cobradas por Mercado Libre</p>
          </div>
        )}
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">Costos + envío</p>
          <p className="text-xl font-bold text-[var(--color-text)] mt-1">{formatCents(totals.cogs + totals.shipping)}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">tu costo {formatCents(totals.cogs)} · envío {formatCents(totals.shipping)}</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">Ganancia</p>
          <p className={`text-xl font-bold mt-1 ${totals.margin < 0 ? 'text-red-600' : 'text-[var(--color-accent)]'}`}>
            {formatCents(totals.margin)}
          </p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">margen {formatPct(totalPct)}</p>
        </div>
      </div>

      {/* Per-order table */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-2">Por pedido</h2>
        {orderRows.length === 0 ? (
          <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              Aún no hay ventas registradas en el libro de ganancias. Registra el costo unitario de
              tus anuncios — cada venta nueva quedará aquí con su margen real.
            </p>
          </div>
        ) : (
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-background)] text-left">
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Pedido</th>
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Ingreso</th>
                    {showMlFees && <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Comisión</th>}
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Envío</th>
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Costo</th>
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Ganancia</th>
                  </tr>
                </thead>
                <tbody>
                  {orderRows.map((r) => (
                    <tr key={r.order_id} className="border-t border-[var(--color-border)]">
                      <td className="px-3 py-2">
                        <p className="text-[var(--color-text)] font-medium truncate max-w-[16rem]">
                          {r.display_id != null ? `#${r.display_id} · ` : ''}{r.title}
                        </p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {fmtDate(r.created_at)}
                          {r.source === 'mercadolibre' ? ' · Mercado Libre' : ''}
                        </p>
                        {r.pending.length > 0 && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            {r.pending.map((p) => PENDING_LABEL[p]).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.revenue_cents)}</td>
                      {showMlFees && <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.fees_cents)}</td>}
                      <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.shipping_cents)}</td>
                      <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.cogs_cents)}</td>
                      <td className="px-3 py-2"><MarginCell cents={r.margin_cents} pct={r.margin_pct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Per-SKU table */}
      {skuRows.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">Por producto</h2>
          <p className="text-xs text-[var(--color-muted)] mb-2">
            Sin envío (el envío es un costo por pedido, no por producto).
          </p>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-background)] text-left">
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Producto</th>
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Unidades</th>
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Ingreso</th>
                    {showMlFees && <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Comisión</th>}
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Costo</th>
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">Ganancia</th>
                  </tr>
                </thead>
                <tbody>
                  {skuRows.map((r) => (
                    <tr key={r.product_id} className="border-t border-[var(--color-border)]">
                      <td className="px-3 py-2 text-[var(--color-text)] font-medium truncate max-w-[16rem]">{r.title}</td>
                      <td className="px-3 py-2 text-[var(--color-text)]">{r.units}</td>
                      <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.revenue_cents)}</td>
                      {showMlFees && <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.fees_cents)}</td>}
                      <td className="px-3 py-2 text-[var(--color-text)]">{formatCents(r.cogs_cents)}</td>
                      <td className="px-3 py-2"><MarginCell cents={r.margin_cents} pct={r.margin_pct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        Los montos se congelan al momento de cada venta: cambiar tu costo unitario después no
        reescribe el historial. Las piezas pendientes (envío, comisión) se completan solas cuando
        llegan — por ejemplo, al comprar la guía de envío.
      </p>
    </div>
  )
}
