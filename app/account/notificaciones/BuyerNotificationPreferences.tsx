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
 * Sprint 1 scope — EMAIL is the only live buyer channel:
 *   • Compras × Email is locked "Siempre" (the receipt — forced-on in the resolver).
 *   • Envíos/Ofertas/Devoluciones × Email toggle live and persist.
 *   • Push + Telegram columns are inert ("Pronto" / "Conecta para activar") —
 *     both land in Sprint 2 (buyer push wiring + buyer Telegram link).
 */

const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  push: 'Push',
  telegram: 'Telegram',
}

// Sprint-1 inert channels: only Email delivers to buyers this sprint. Push +
// Telegram are shown but disabled ("Pronto" / "Conecta para activar") — both are
// wired in Sprint 2. (The Compras × Email receipt cell is locked separately, via
// isBuyerForcedCell.)
function lockedInS1(_group: string, channel: Channel): boolean {
  return channel === 'push' || channel === 'telegram'
}

export default function BuyerNotificationPreferences() {
  const [prefs, setPrefs] = useState<BuyerPrefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Telegram link state: null = unknown, false = not linked, true = connected.
  const [linked, setLinked] = useState<boolean | null>(null)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgMsg, setTgMsg] = useState<string | null>(null)

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

  // Telegram link status — refetched on tab focus, so returning from the Telegram
  // app after sending /start flips the UI to "Conectado".
  useEffect(() => {
    let active = true
    function refreshLink() {
      fetch('/api/account/telegram/link')
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { linked: boolean }) => active && setLinked(!!d.linked))
        .catch(() => active && setLinked(false))
    }
    refreshLink()
    const onVis = () => document.visibilityState === 'visible' && refreshLink()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  async function connectTelegram() {
    setTgBusy(true)
    setTgMsg(null)
    try {
      const res = await fetch('/api/account/telegram/link', { method: 'POST' })
      const d = await res.json()
      if (!res.ok || !d.url) throw new Error(d.error || String(res.status))
      window.open(d.url, '_blank', 'noopener,noreferrer')
      setTgMsg('Abre Telegram y envía el mensaje. Al volver, esta página se actualizará.')
    } catch {
      setTgMsg('No se pudo generar el enlace. Inténtalo de nuevo.')
    } finally {
      setTgBusy(false)
    }
  }

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
          channelHint={ch =>
            ch === 'telegram' ? 'Conecta para activar' : ch === 'push' ? 'Pronto' : null
          }
          cellNote={(g, ch) => (isBuyerForcedCell(g as BuyerEventGroup, ch) ? 'Siempre' : null)}
        />
      ) : null}

      {error && <div className="mt-3 text-xs text-[var(--color-danger)]">{error}</div>}

      {/* Telegram connection — links the person's single chat (shared with the
          seller portal). The grid's Telegram column activates once connected. */}
      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <div className="mb-1 text-sm font-medium">Telegram</div>
        {linked ? (
          <span className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]">
            Conectado ✓
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--color-muted)]">
              Conecta Telegram para recibir avisos de tus compras al instante. Luego activa los que quieras
              arriba.
            </p>
            <button
              type="button"
              onClick={connectTelegram}
              disabled={tgBusy}
              className="self-start rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Conecta Telegram
            </button>
          </div>
        )}
        {tgMsg && <div className="mt-2 text-xs text-[var(--color-muted)]">{tgMsg}</div>}
      </div>

      <p className="mt-4 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted)]">
        El recibo de tu compra y pago siempre llega por correo (no se puede apagar).
      </p>
    </section>
  )
}
