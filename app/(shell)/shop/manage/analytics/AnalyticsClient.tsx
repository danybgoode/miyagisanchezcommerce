'use client'

import { SellerBreadcrumb } from '../SellerBreadcrumb'

interface AnalyticsData {
  mrr: number
  arr: number
  activeCount: number
  newThisMonth: number
  churnedThisMonth: number
  pendingCount: number
  currency: string
  planBreakdown: Array<{ title: string; activeCount: number; mrr: number; currency: string }>
  recentSubs: Array<{
    buyer_email: string
    buyer_name: string | null
    status: string
    payment_method: string
    tier_id: string | null
    created_at: string
    listing_title: string
  }>
}

function fmt(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, minimumFractionDigits: 0 }).format(cents / 100)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

const STATUS_COLOR: Record<string, string> = {
  active:               'bg-green-100 text-green-800',
  trialing:             'bg-blue-100 text-blue-800',
  past_due:             'bg-amber-100 text-amber-800',
  canceled:             'bg-gray-100 text-gray-600',
  pending_confirmation: 'bg-purple-100 text-purple-800',
  pending_authorization:'bg-purple-100 text-purple-800',
}

export default function AnalyticsClient({ data, shopName }: { data: AnalyticsData; shopName: string }) {
  const churnRate = data.activeCount + data.churnedThisMonth > 0
    ? ((data.churnedThisMonth / (data.activeCount + data.churnedThisMonth)) * 100).toFixed(1)
    : '0.0'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Nav */}
      <SellerBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Analíticas de suscripciones</h1>
        <p className="text-[var(--color-muted)] text-sm mt-1">{shopName}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">MRR</p>
          <p className="text-xl font-bold text-[var(--color-accent)] mt-1">{fmt(data.mrr, data.currency)}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">ingresos / mes</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">ARR</p>
          <p className="text-xl font-bold text-[var(--color-text)] mt-1">{fmt(data.arr, data.currency)}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">ingresos / año</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">Suscriptores</p>
          <p className="text-xl font-bold text-[var(--color-text)] mt-1">{data.activeCount}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">activos ahora</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl p-4">
          <p className="text-xs text-[var(--color-muted)] font-medium">Churn (30d)</p>
          <p className={`text-xl font-bold mt-1 ${data.churnedThisMonth > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {churnRate}%
          </p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{data.churnedThisMonth} cancelaciones</p>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[var(--color-border)] rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">🆕</span>
          <div>
            <p className="text-lg font-bold text-[var(--color-text)]">+{data.newThisMonth}</p>
            <p className="text-xs text-[var(--color-muted)]">nuevos este mes</p>
          </div>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">⏳</span>
          <div>
            <p className="text-lg font-bold text-[var(--color-text)]">{data.pendingCount}</p>
            <p className="text-xs text-[var(--color-muted)]">pendientes de confirmación</p>
          </div>
        </div>
      </div>

      {/* Plan breakdown */}
      {data.planBreakdown.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">Desglose por plan</h2>
          <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-background)]">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--color-muted)]">Plan</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--color-muted)]">Activos</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--color-muted)]">MRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.planBreakdown.map((row, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-medium text-[var(--color-text)] truncate max-w-[180px]">{row.title}</td>
                    <td className="px-4 py-3 text-right text-[var(--color-text)]">{row.activeCount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--color-accent)]">{fmt(row.mrr, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent subscribers */}
      <section>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">Suscriptores recientes</h2>
        {data.recentSubs.length === 0 ? (
          <div className="text-center py-10 text-[var(--color-muted)]">
            <p className="text-3xl mb-2"><i className="iconoir-stats-report" aria-hidden /></p>
            <p className="text-sm">Aún no hay suscriptores.</p>
          </div>
        ) : (
          <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-background)]">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--color-muted)]">Comprador</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--color-muted)] hidden sm:table-cell">Método</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--color-muted)]">Estado</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--color-muted)]">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.recentSubs.map((sub, i) => {
                  const statusCls = STATUS_COLOR[sub.status] ?? 'bg-gray-100 text-gray-600'
                  return (
                    <tr key={i}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--color-text)] truncate max-w-[160px]">{sub.buyer_name ?? 'Comprador'}</p>
                        <p className="text-xs text-[var(--color-muted)] truncate">{sub.listing_title}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-xs uppercase font-medium text-[var(--color-muted)]">{sub.payment_method}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>{sub.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--color-muted)]">{fmtDate(sub.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
