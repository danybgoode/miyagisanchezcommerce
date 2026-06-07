'use client'

import { useEffect, useState } from 'react'
import {
  EVENT_GROUPS,
  CHANNELS,
  DEFAULT_PREFS,
  GROUP_COPY,
  type Prefs,
  type EventGroup,
  type Channel,
} from '@/lib/notifications/preferences'

/**
 * Seller preference center — channels × event-groups grid.
 * Self-contained island: fetches/saves via /api/sell/notification-preferences,
 * independent of the big ShopSettings save flow. es-MX (matches this panel).
 *
 * Telegram column is shown but inert ("Conecta para activar") — Sprint 2 lights
 * it up with the seller Telegram link. Email/Push toggle live and persist.
 */

// Group label + summary come from the shared GROUP_COPY (one source of truth with
// the dispatch vocabulary) so what we show can't drift from what the seam sends.
const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  push: 'Push',
  telegram: 'Telegram',
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      } ${checked ? 'bg-[var(--color-accent)]' : 'bg-gray-300'}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Telegram link state: null = unknown, false = not linked, true = connected.
  const [linked, setLinked] = useState<boolean | null>(null)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgMsg, setTgMsg] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/sell/notification-preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { prefs: Prefs }) => {
        if (active) setPrefs(d.prefs)
      })
      .catch(() => {
        // Degrade gracefully: show the defaults so the grid still renders.
        if (active) setPrefs(DEFAULT_PREFS)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  // Telegram link status — refetched whenever the tab regains focus, so returning
  // from the Telegram app after sending /start flips the UI to "Conectado".
  useEffect(() => {
    let active = true
    function refreshLink() {
      fetch('/api/sell/telegram/link')
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
      const res = await fetch('/api/sell/telegram/link', { method: 'POST' })
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
      const res = await fetch('/api/sell/telegram/link', { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      setLinked(false)
      // Locally clear Telegram toggles so the grid matches the (now inert) column.
      if (prefs) {
        setPrefs(
          EVENT_GROUPS.reduce(
            (acc, g) => ({ ...acc, [g]: { ...prefs[g], telegram: false } }),
            { ...prefs } as Prefs,
          ),
        )
      }
      setTgMsg('Telegram desconectado.')
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
      const res = await fetch('/api/sell/telegram/test', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      setTgMsg('Te enviamos una prueba a Telegram.')
    } catch {
      setTgMsg('No se pudo enviar la prueba.')
    } finally {
      setTgBusy(false)
    }
  }

  async function toggle(group: EventGroup, channel: Channel, next: boolean) {
    if (!prefs) return
    const prev = prefs
    // optimistic
    setPrefs({ ...prefs, [group]: { ...prefs[group], [channel]: next } })
    setError(null)
    try {
      const res = await fetch('/api/sell/notification-preferences', {
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
    <section id="notif-prefs" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
      <div className="mb-1 text-base font-semibold">¿Qué te avisamos y por dónde?</div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Elige los canales por tipo de evento. Lo que apagues deja de llegarte.
      </p>

      {loading ? (
        <div className="py-6 text-sm text-[var(--color-muted)]">Cargando…</div>
      ) : prefs ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th className="py-2 pr-3 font-medium">Evento</th>
                {CHANNELS.map(ch => (
                  <th key={ch} className="px-3 py-2 text-center font-medium">
                    {CHANNEL_LABELS[ch]}
                    {ch === 'telegram' && !linked && (
                      <div className="text-[10px] font-normal text-[var(--color-muted)]">
                        Conecta para activar
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENT_GROUPS.map(group => (
                <tr key={group} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{GROUP_COPY[group].label}</div>
                    <div className="text-xs text-[var(--color-muted)]">{GROUP_COPY[group].summary}</div>
                  </td>
                  {CHANNELS.map(ch => {
                    // Telegram toggles are inert until the seller links a chat.
                    const locked = ch === 'telegram' && !linked
                    return (
                      <td key={ch} className="px-3 py-3 text-center">
                        <div className="inline-flex justify-center">
                          <Switch
                            checked={locked ? false : prefs[group][ch]}
                            disabled={locked}
                            onChange={v => toggle(group, ch, v)}
                            label={`${GROUP_COPY[group].label} · ${CHANNEL_LABELS[ch]}`}
                          />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error && <div className="mt-3 text-xs text-[var(--color-danger)]">{error}</div>}

      {/* Telegram connection — the column above is interactive only once linked. */}
      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <div className="mb-1 text-sm font-medium">Telegram</div>
        {linked ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]">
              Conectado ✓
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
              Conecta Telegram para recibir avisos al instante. Activa los que quieras arriba.
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
    </section>
  )
}
