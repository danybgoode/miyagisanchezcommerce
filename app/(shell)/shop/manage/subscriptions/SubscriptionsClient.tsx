'use client'

import { useState } from 'react'

interface Subscription {
  id: string
  buyer_email: string
  buyer_name: string | null
  status: string
  payment_method: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  marketplace_listings: { id: string; title: string; price_cents: number | null; currency: string } | { id: string; title: string; price_cents: number | null; currency: string }[]
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:               { label: 'Activa',           color: 'bg-green-100 text-green-800' },
  trialing:             { label: 'Prueba',            color: 'bg-blue-100 text-blue-800' },
  past_due:             { label: 'Pago pendiente',    color: 'bg-amber-100 text-amber-800' },
  canceled:             { label: 'Cancelada',         color: 'bg-gray-100 text-gray-600' },
  pending_confirmation: { label: 'Pendiente SPEI',   color: 'bg-purple-100 text-purple-800' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatPrice(cents: number | null, currency: string): string {
  if (!cents) return '—'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
}

export default function SubscriptionsClient({
  shopName,
  subscriptions: initialSubs,
}: {
  shopName: string
  subscriptions: Subscription[]
}) {
  const [subs, setSubs] = useState(initialSubs)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = subs.filter(s => s.status === 'pending_confirmation')
  const active  = subs.filter(s => s.status === 'active' || s.status === 'trialing')
  const other   = subs.filter(s => !['pending_confirmation', 'active', 'trialing'].includes(s.status))

  async function confirmSpei(id: string) {
    setConfirming(id)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/spei/${id}/confirm`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Error al confirmar.'); return }
      setSubs(prev => prev.map(s => s.id === id ? { ...s, status: 'active' } : s))
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setConfirming(null)
    }
  }

  function getListing(sub: Subscription) {
    const l = sub.marketplace_listings
    return Array.isArray(l) ? l[0] : l
  }

  function renderRow(sub: Subscription, showConfirm: boolean) {
    const listing = getListing(sub)
    const st = STATUS_LABEL[sub.status] ?? { label: sub.status, color: 'bg-gray-100 text-gray-600' }
    return (
      <div key={sub.id} className="border border-[var(--color-border)] rounded-lg p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{sub.buyer_name ?? 'Comprador'}</p>
            <p className="text-xs text-[var(--color-muted)] truncate">Suscripción {sub.id.slice(0, 8)}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>
            {st.label}
          </span>
        </div>
        <div className="text-xs text-[var(--color-muted)] space-y-0.5">
          <p>Plan: <span className="text-[var(--color-text)]">{listing?.title ?? '—'}</span> · {formatPrice(listing?.price_cents ?? null, listing?.currency ?? 'MXN')}</p>
          <p>Método: <span className="font-medium uppercase">{sub.payment_method}</span></p>
          {sub.current_period_end && (
            <p>Próximo cobro: {formatDate(sub.current_period_end)}</p>
          )}
          <p>Suscrito el: {formatDate(sub.created_at)}</p>
        </div>
        {showConfirm && sub.status === 'pending_confirmation' && (
          <button
            type="button"
            onClick={() => confirmSpei(sub.id)}
            disabled={confirming === sub.id}
            className="w-full bg-[var(--color-accent)] text-white text-sm font-semibold py-2 rounded transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            {confirming === sub.id ? 'Confirmando…' : '✓ Confirmar pago SPEI recibido'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Nav */}
      <div className="flex items-center gap-3 text-sm">
        <a href="/shop/manage" className="text-[var(--color-accent)] hover:underline">← Mi tienda</a>
        <span className="text-[var(--color-muted)]">/</span>
        <span className="text-[var(--color-text)] font-medium">Suscripciones</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Suscripciones</h1>
        <p className="text-[var(--color-muted)] text-sm mt-1">{shopName} · {subs.length} suscriptores en total</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3 flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      {/* Pending SPEI confirmations */}
      {pending.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-amber-700 mb-3 flex items-center gap-2">
            <span>⏳</span> Pendientes de confirmación ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map(s => renderRow(s, true))}
          </div>
        </section>
      )}

      {/* Active */}
      {active.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">
            Activas ({active.length})
          </h2>
          <div className="space-y-3">
            {active.map(s => renderRow(s, false))}
          </div>
        </section>
      )}

      {/* Other */}
      {other.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[var(--color-muted)] mb-3">
            Historial ({other.length})
          </h2>
          <div className="space-y-3">
            {other.map(s => renderRow(s, false))}
          </div>
        </section>
      )}

      {subs.length === 0 && (
        <div className="text-center py-16 text-[var(--color-muted)]">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-medium">Aún no tienes suscriptores</p>
          <p className="text-sm mt-1">Publica un anuncio de tipo Suscripción para comenzar.</p>
        </div>
      )}
    </div>
  )
}
