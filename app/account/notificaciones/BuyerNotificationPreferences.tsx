'use client'

import { useEffect, useState } from 'react'
import {
  BUYER_EVENT_GROUPS,
  CHANNELS,
  BUYER_DEFAULT_PREFS,
  BUYER_GROUP_COPY,
  isBuyerForcedCell,
  type BuyerPrefs,
  type BuyerEventGroup,
  type Channel,
} from '@/lib/notifications/preferences'
import NotificationPreferencesGrid from '@/app/components/NotificationPreferencesGrid'

/**
 * Buyer preference center (epic #5b, Sprint 1) — channels × event-groups grid in
 * the buyer's account. Self-contained island: fetches/saves via
 * /api/account/notification-preferences. Renders the shared
 * NotificationPreferencesGrid (same component the seller panel uses). es-MX.
 *
 * Sprint 1 scope:
 *   • Compras × Email is locked "Siempre" (the receipt — forced-on in the resolver).
 *   • Compras × Push/Telegram are inert ("pronto") — those events fire from the
 *     payment webhooks, wired in Sprint 2.
 *   • Telegram column is inert ("Conecta para activar") — the buyer link flow is
 *     Sprint 2. Envíos/Ofertas/Devoluciones email + push toggle live and persist.
 */

const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  push: 'Push',
  telegram: 'Telegram',
}

// Sprint-1 inert cells: the whole Telegram column (no buyer link yet) + the
// Compras push cell (its events fire from the payment webhooks, wired in S2).
function lockedInS1(group: string, channel: Channel): boolean {
  if (channel === 'telegram') return true
  if (group === 'buyer.compras' && channel === 'push') return true
  return false
}

export default function BuyerNotificationPreferences() {
  const [prefs, setPrefs] = useState<BuyerPrefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/account/notification-preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { prefs: BuyerPrefs }) => {
        if (active) setPrefs(d.prefs)
      })
      .catch(() => {
        // Degrade gracefully: show the defaults so the grid still renders.
        if (active) setPrefs(BUYER_DEFAULT_PREFS)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  async function toggle(group: BuyerEventGroup, channel: Channel, next: boolean) {
    if (!prefs) return
    // The receipt cell + inert cells are never togglable; guard before any write.
    if (isBuyerForcedCell(group, channel) || lockedInS1(group, channel)) return
    const prev = prefs
    setPrefs({ ...prefs, [group]: { ...prefs[group], [channel]: next } })
    setError(null)
    try {
      const res = await fetch('/api/account/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, event_group: group, enabled: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setPrefs(prev) // revert
      setError('No se pudo guardar el cambio. Inténtalo de nuevo.')
    }
  }

  return (
    <section className="border border-[var(--color-border)] rounded-xl p-5">
      <div className="mb-1 text-base font-semibold">¿Qué te avisamos y por dónde?</div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Elige los canales por tipo de evento. Lo que apagues deja de llegarte.
      </p>

      {loading ? (
        <div className="py-6 text-sm text-[var(--color-muted)]">Cargando…</div>
      ) : prefs ? (
        <NotificationPreferencesGrid
          groups={BUYER_EVENT_GROUPS}
          groupCopy={BUYER_GROUP_COPY}
          channels={CHANNELS}
          channelLabels={CHANNEL_LABELS}
          toggle={(g, ch, v) => toggle(g as BuyerEventGroup, ch, v)}
          isLocked={(g, ch) => isBuyerForcedCell(g as BuyerEventGroup, ch) || lockedInS1(g, ch)}
          isChecked={(g, ch) =>
            isBuyerForcedCell(g as BuyerEventGroup, ch)
              ? true
              : lockedInS1(g, ch)
                ? false
                : prefs[g as BuyerEventGroup][ch]
          }
          channelHint={ch => (ch === 'telegram' ? 'Conecta para activar' : null)}
          cellNote={(g, ch) =>
            isBuyerForcedCell(g as BuyerEventGroup, ch)
              ? 'Siempre'
              : g === 'buyer.compras' && ch === 'push'
                ? 'pronto'
                : null
          }
        />
      ) : null}

      {error && <div className="mt-3 text-xs text-[var(--color-danger)]">{error}</div>}

      <p className="mt-4 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted)]">
        El recibo de tu compra y pago siempre llega por correo (no se puede apagar). Telegram para
        compradores llega pronto.
      </p>
    </section>
  )
}
