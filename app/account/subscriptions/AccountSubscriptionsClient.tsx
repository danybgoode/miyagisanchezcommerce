'use client'

import { useState } from 'react'

interface Subscription {
  id: string
  status: string
  payment_method: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  marketplace_listings: { id: string; title: string; price_cents: number | null; currency: string; metadata: unknown }
    | { id: string; title: string; price_cents: number | null; currency: string; metadata: unknown }[]
  marketplace_shops: { id: string; name: string; slug: string }
    | { id: string; name: string; slug: string }[]
}

interface ContentItem {
  id: string
  shop_id: string
  listing_id: string | null
  title: string
  body: string | null
  file_url: string | null
  file_type: string | null
  created_at: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:               { label: 'Activa',         color: 'bg-green-100 text-green-800' },
  trialing:             { label: 'Prueba',          color: 'bg-blue-100 text-blue-800' },
  past_due:             { label: 'Pago atrasado',   color: 'bg-amber-100 text-amber-800' },
  canceled:             { label: 'Cancelada',       color: 'bg-gray-100 text-gray-600' },
  pending_confirmation: { label: 'Pendiente SPEI',  color: 'bg-purple-100 text-purple-800' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatPrice(cents: number | null, currency: string): string {
  if (!cents) return '—'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
}

export default function AccountSubscriptionsClient({
  subscriptions,
  content,
}: {
  subscriptions: Subscription[]
  content: ContentItem[]
}) {
  const [canceling, setCanceling] = useState<string | null>(null)
  const [subs, setSubs] = useState(subscriptions)
  const [error, setError] = useState<string | null>(null)

  function getShop(sub: Subscription) {
    const s = sub.marketplace_shops
    return Array.isArray(s) ? s[0] : s
  }
  function getListing(sub: Subscription) {
    const l = sub.marketplace_listings
    return Array.isArray(l) ? l[0] : l
  }

  async function handleCancel(id: string) {
    if (!confirm('¿Cancelar la suscripción al final del período actual?')) return
    setCanceling(id)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${id}/cancel`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Error al cancelar.'); return }
      setSubs(prev => prev.map(s => s.id === id ? { ...s, cancel_at_period_end: true } : s))
    } catch {
      setError('Sin conexión.')
    } finally {
      setCanceling(null)
    }
  }

  // Group content by shop_id
  const contentByShop: Record<string, ContentItem[]> = {}
  for (const item of content) {
    if (!contentByShop[item.shop_id]) contentByShop[item.shop_id] = []
    contentByShop[item.shop_id].push(item)
  }

  const active = subs.filter(s => s.status === 'active' || s.status === 'trialing')

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Mis suscripciones</h1>
        <p className="text-[var(--color-muted)] text-sm mt-1">{subs.length} suscripciones</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3 flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      {/* Active subscriptions with content */}
      {active.map(sub => {
        const shop    = getShop(sub)
        const listing = getListing(sub)
        const st      = STATUS_LABEL[sub.status] ?? { label: sub.status, color: 'bg-gray-100 text-gray-600' }
        const shopContent = contentByShop[shop?.id ?? ''] ?? []

        return (
          <section key={sub.id} className="border border-[var(--color-border)] rounded-xl overflow-hidden">
            {/* Subscription header */}
            <div className="bg-[var(--color-background)] px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--color-text)]">{shop?.name ?? '—'}</p>
                <p className="text-sm text-[var(--color-muted)]">{listing?.title ?? '—'} · {formatPrice(listing?.price_cents ?? null, listing?.currency ?? 'MXN')}</p>
                {sub.current_period_end && (
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                    {sub.cancel_at_period_end
                      ? `Cancela el ${formatDate(sub.current_period_end)}`
                      : `Próximo cobro: ${formatDate(sub.current_period_end)}`}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                {!sub.cancel_at_period_end && (
                  <button
                    type="button"
                    onClick={() => handleCancel(sub.id)}
                    disabled={canceling === sub.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-60"
                  >
                    {canceling === sub.id ? 'Cancelando…' : 'Cancelar'}
                  </button>
                )}
              </div>
            </div>

            {/* Content feed */}
            {shopContent.length > 0 ? (
              <div className="divide-y divide-[var(--color-border)]">
                {shopContent.map(item => (
                  <div key={item.id} className="px-5 py-4">
                    <p className="font-medium text-sm text-[var(--color-text)]">{item.title}</p>
                    {item.body && (
                      <p className="text-sm text-[var(--color-muted)] mt-1 whitespace-pre-line">{item.body}</p>
                    )}
                    {item.file_url && (
                      <a
                        href={item.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] mt-2 hover:underline"
                      >
                        📎 Ver archivo
                      </a>
                    )}
                    <p className="text-xs text-[var(--color-muted)] mt-2">{formatDate(item.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-[var(--color-muted)]">
                <p className="text-sm">El creador aún no ha publicado contenido exclusivo.</p>
              </div>
            )}
          </section>
        )
      })}

      {/* Inactive subscriptions */}
      {subs.filter(s => !['active', 'trialing'].includes(s.status)).map(sub => {
        const shop    = getShop(sub)
        const listing = getListing(sub)
        const st      = STATUS_LABEL[sub.status] ?? { label: sub.status, color: 'bg-gray-100 text-gray-600' }
        return (
          <div key={sub.id} className="border border-[var(--color-border)] rounded-xl p-4 flex items-center justify-between gap-3 opacity-60">
            <div>
              <p className="font-medium text-sm">{shop?.name ?? '—'}</p>
              <p className="text-xs text-[var(--color-muted)]">{listing?.title ?? '—'}</p>
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
          </div>
        )
      })}

      {subs.length === 0 && (
        <div className="text-center py-16 text-[var(--color-muted)]">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-medium">No tienes suscripciones activas</p>
          <p className="text-sm mt-1">Explora anuncios de tipo Suscripción para acceder a contenido exclusivo.</p>
          <a href="/" className="inline-block mt-4 text-sm text-[var(--color-accent)] hover:underline">
            Explorar →
          </a>
        </div>
      )}
    </div>
  )
}
