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
 * Buyer preference center (epic #5b) — channels × event-groups grid in
 * the buyer's account. Self-contained island: fetches/saves via
 * /api/account/notification-preferences. Renders the shared
 * NotificationPreferencesGrid (same component the seller panel uses). es-MX.
 *
 * Sprint 2 — every cell live except the forced receipt:
 *   • Compras × Email is locked "Siempre" (the receipt — forced-on in the resolver).
 *   • Every other cell (including Compras × Push/Telegram) toggles live and persists
 *     — Compras now dispatches through the seam from the Stripe/MP webhooks +
 *     finalize-manual (Sprint 2.1/2.2).
 *   • Telegram toggles activate once the person links a chat (shared with the
 *     seller portal); the connect/test/disconnect block lives below the grid.
 */

const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  push: 'Push',
  telegram: 'Telegram',
}

// The only cell NOT yet togglable: Telegram for any group until the person links
// a chat. (Compras × Email is locked separately as the forced receipt, via
// isBuyerForcedCell — Compras × Push/Telegram are live like every other group.)
function lockedS2(_group: string, channel: Channel, linked: boolean): boolean {
  if (channel === 'telegram') return !linked
  return false
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

  async function disconnectTelegram() {
    setTgBusy(true)
    setTgMsg(null)
    try {
      const res = await fetch('/api/account/telegram/link', { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      const d = await res.json().catch(() => ({ rowDeleted: true }))
      setLinked(false)
      // Locally clear Telegram toggles so the grid matches the (now inert) column.
      if (prefs) {
        setPrefs(
          BUYER_EVENT_GROUPS.reduce(
            (acc, g) => ({ ...acc, [g]: { ...prefs[g], telegram: false } }),
            { ...prefs } as BuyerPrefs,
          ),
        )
      }
      setTgMsg(
        d.rowDeleted
          ? 'Telegram desconectado.'
          : 'Telegram desconectado para tus compras. Tu Telegram de vendedor sigue conectado.',
      )
    } catch {
      setTgMsg('No se pudo desconectar. Inténtalo de nuevo.')
    } finally {
      setTgBusy(false)
    }
  }

  async function sendTest() {
    setTgBusy(true)
    setTgMsg(null)
    try {
      const res = await fetch('/api/account/telegram/test', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      setTgMsg('Te enviamos una prueba a Telegram.')
    } catch {
      setTgMsg('No se pudo enviar la prueba.')
    } finally {
      setTgBusy(false)
    }
  }

  async function toggle(group: BuyerEventGroup, channel: Channel, next: boolean) {
    if (!prefs) return
    // The receipt cell + not-yet-togglable cells are guarded before any write.
    if (isBuyerForcedCell(group, channel) || lockedS2(group, channel, !!linked)) return
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
          isLocked={(g, ch) => isBuyerForcedCell(g as BuyerEventGroup, ch) || lockedS2(g, ch, !!linked)}
          isChecked={(g, ch) =>
            isBuyerForcedCell(g as BuyerEventGroup, ch)
              ? true
              : lockedS2(g, ch, !!linked)
                ? false
                : prefs[g as BuyerEventGroup][ch]
          }
          channelHint={ch => (ch === 'telegram' && !linked ? 'Conecta para activar' : null)}
          cellNote={(g, ch) => (isBuyerForcedCell(g as BuyerEventGroup, ch) ? 'Siempre' : null)}
        />
      ) : null}

      {error && <div className="mt-3 text-xs text-[var(--color-danger)]">{error}</div>}

      {/* Telegram connection — links the person's single chat (shared with the
          seller portal). The grid's Telegram column activates once connected. */}
      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <div className="mb-1 text-sm font-medium">Telegram</div>
        {linked ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]">
              Conectado <i className="iconoir-check" aria-hidden />
            </span>
            <button
              type="button"
              onClick={sendTest}
              disabled={tgBusy}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50"
            >
              Enviar prueba
            </button>
            <button
              type="button"
              onClick={disconnectTelegram}
              disabled={tgBusy}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-black/5 disabled:opacity-50"
            >
              Desconectar
            </button>
          </div>
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
