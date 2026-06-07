'use client'

import { useEffect, useState } from 'react'
import {
  EVENT_GROUPS,
  CHANNELS,
  DEFAULT_PREFS,
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

const GROUP_LABELS: Record<EventGroup, { label: string; desc: string }> = {
  orders:   { label: 'Pedidos',      desc: 'Nuevas ventas y su seguimiento.' },
  offers:   { label: 'Ofertas',      desc: 'Cuando alguien hace una oferta.' },
  payments: { label: 'Pagos',        desc: 'Confirmaciones y avisos de pago.' },
  returns:  { label: 'Devoluciones', desc: 'Solicitudes de devolución.' },
}
const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  push: 'Push',
  telegram: 'Telegram',
}
/** Telegram delivery arrives in Sprint 2 — the column stays inert until then. */
const LOCKED_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(['telegram'])

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

  useEffect(() => {
    let active = true
    fetch('/api/sell/notification-preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { prefs: Prefs }) => {
        if (active) setPrefs(d.prefs)
      })
      .catch(() => {
        // Degrade gracefully: show the all-on defaults so the grid still renders.
        if (active) setPrefs(DEFAULT_PREFS)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

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
                    {LOCKED_CHANNELS.has(ch) && (
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
                    <div className="font-medium">{GROUP_LABELS[group].label}</div>
                    <div className="text-xs text-[var(--color-muted)]">{GROUP_LABELS[group].desc}</div>
                  </td>
                  {CHANNELS.map(ch => {
                    const locked = LOCKED_CHANNELS.has(ch)
                    return (
                      <td key={ch} className="px-3 py-3 text-center">
                        <div className="inline-flex justify-center">
                          <Switch
                            checked={locked ? false : prefs[group][ch]}
                            disabled={locked}
                            onChange={v => toggle(group, ch, v)}
                            label={`${GROUP_LABELS[group].label} · ${CHANNEL_LABELS[ch]}`}
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

      {error && <div className="mt-3 text-xs text-[var(--color-danger,#c0392b)]">{error}</div>}
    </section>
  )
}
