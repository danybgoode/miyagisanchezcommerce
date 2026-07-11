import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { getPromoterByCode, listCommissionsForPromoter } from '@/lib/promoter'
import { summarizeCommissions } from '@/lib/promoter-commission'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis comisiones — Promotor', robots: { index: false } }

const mxn = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

const SKU_LABEL: Record<string, string> = {
  custom_domain: 'Dominio propio',
  print_ad: 'Anuncio impreso',
  migration: 'Migración de tienda',
}

/**
 * Promoter commission dashboard (epic 08 · S3 · US-8). Code-addressed and read-only:
 * the PRM- code is the bearer (same trust model as the share link), so a promoter
 * sees what they've earned without a Clerk login (promoters are admin-provisioned
 * rows in v1). Hidden behind `promoter.enabled` (404 when off). No money moves —
 * settlement is offline (the admin marks paid after cash/transfer).
 */
export default async function PromoterDashboardPage({ params }: { params: Promise<{ code: string }> }) {
  if (!(await isEnabled('promoter.enabled'))) notFound()

  const { code } = await params
  const promoter = await getPromoterByCode(code)
  if (!promoter) notFound()

  const commissions = await listCommissionsForPromoter(promoter.id)
  const totals = summarizeCommissions(commissions)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Mis comisiones</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Promotor <span className="font-mono font-semibold">{promoter.code}</span>
          {promoter.name && <span className="ml-2">· {promoter.name}</span>}
        </p>
      </div>

      {/* Totals */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { label: 'Ganado', value: totals.earnedCents },
          { label: 'Pendiente', value: totals.pendingCents },
          { label: 'Pagado', value: totals.paidCents },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-[var(--color-border)] p-3 text-center">
            <div className="text-xs text-[var(--color-muted)]">{t.label}</div>
            <div className="text-lg font-semibold mt-1">{mxn(t.value)}</div>
          </div>
        ))}
      </section>

      {/* Commission lines */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Detalle</h2>
        {commissions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Aún no tienes comisiones. Aparecerán aquí cuando una venta atribuida a tu código se pague.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {commissions.map((c) => (
              <li key={c.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">{SKU_LABEL[c.sku ?? ''] ?? c.sku ?? '—'}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {c.rate_pct}% de {mxn(c.gross_amount_cents)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{mxn(c.commission_cents)}</div>
                  <span
                    className="text-xs rounded px-1.5 py-0.5 bg-[var(--color-surface-alt)]"
                  >
                    {c.status === 'paid' ? 'Pagada' : 'Pendiente'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
