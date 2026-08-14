'use client'

import { useMemo, useState } from 'react'
import {
  COMMUNICATION_ACTORS,
  filterCommunications,
  type CommunicationActor,
  type CommunicationEntry,
  type CommunicationFilter,
} from '@/lib/notifications/catalog'
import type { Channel } from '@/lib/notifications/preferences'

/**
 * The communications matrix (marketplace-communications · S2.1, S2.2, S3.2).
 *
 * Renders the catalog and filters it in memory through the SAME pure
 * `filterCommunications` the api spec asserts over — so what the spec proves and
 * what this screen shows cannot drift.
 *
 * The "Enviarme esta" control posts to `/api/admin/comunicaciones/sample`, which
 * constrains the recipient to a compile-time allow-list. The picker here offers only
 * those three addresses, but the server refuses anything else regardless — the UI is
 * a convenience, not the control.
 */
type Row = CommunicationEntry & { sendable: boolean }

const ACTOR_LABEL: Record<CommunicationActor, string> = {
  platform: 'Plataforma',
  admin: 'Admin',
  seller: 'Vendedor',
  buyer: 'Comprador',
  promoter: 'Promotor',
}

const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Correo',
  push: 'Push',
  telegram: 'Telegram',
}

type SendState = { key: string; status: 'sending' | 'sent' | 'error'; message?: string }

export default function ComunicacionesClient({
  rows,
  recipients,
}: {
  rows: Row[]
  recipients: string[]
}) {
  const [filter, setFilter] = useState<CommunicationFilter>({})
  const [recipient, setRecipient] = useState(recipients[0] ?? '')
  const [send, setSend] = useState<SendState | null>(null)

  const filtered = useMemo(
    () => filterCommunications(rows, filter) as Row[],
    [rows, filter],
  )

  const channels = useMemo(() => {
    const set = new Set<Channel>()
    for (const row of rows) for (const channel of row.channels) set.add(channel)
    return [...set]
  }, [rows])

  async function sendSample(key: string) {
    setSend({ key, status: 'sending' })
    try {
      const res = await fetch('/api/admin/comunicaciones/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, to: recipient }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setSend({ key, status: 'error', message: body?.error ?? `Error ${res.status}` })
        return
      }
      setSend({ key, status: 'sent', message: `Enviado a ${recipient}` })
    } catch {
      setSend({ key, status: 'error', message: 'No se pudo enviar.' })
    }
  }

  function update(patch: Partial<CommunicationFilter>) {
    setFilter((prev) => {
      const next = { ...prev, ...patch }
      // An empty select means "no filter", not a filter on empty string.
      for (const key of Object.keys(next) as (keyof CommunicationFilter)[]) {
        if (!next[key]) delete next[key]
      }
      return next
    })
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Comunicaciones</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Todo lo que la plataforma puede avisar: qué acción lo dispara, quién lo causa, quién lo
          recibe y por cuál canal. Los canales son lo que <em>puede</em> enviarse — cada vendedor
          decide cuáles quiere en sus preferencias.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Buscar</span>
          <input
            type="search"
            value={filter.q ?? ''}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="oferta, pedido, devolución…"
            className="border rounded px-2 py-1 min-w-56"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Lo causa</span>
          <select
            value={filter.from ?? ''}
            onChange={(e) => update({ from: (e.target.value || undefined) as CommunicationActor })}
            className="border rounded px-2 py-1"
          >
            <option value="">Cualquiera</option>
            {COMMUNICATION_ACTORS.map((actor) => (
              <option key={actor} value={actor}>{ACTOR_LABEL[actor]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Lo recibe</span>
          <select
            value={filter.to ?? ''}
            onChange={(e) => update({ to: (e.target.value || undefined) as CommunicationActor })}
            className="border rounded px-2 py-1"
          >
            <option value="">Cualquiera</option>
            {COMMUNICATION_ACTORS.map((actor) => (
              <option key={actor} value={actor}>{ACTOR_LABEL[actor]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Canal</span>
          <select
            value={filter.channel ?? ''}
            onChange={(e) => update({ channel: (e.target.value || undefined) as Channel })}
            className="border rounded px-2 py-1"
          >
            <option value="">Cualquiera</option>
            {channels.map((channel) => (
              <option key={channel} value={channel}>{CHANNEL_LABEL[channel]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Enviarme las pruebas a</span>
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {recipients.map((address) => (
              <option key={address} value={address}>{address}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-[var(--color-muted)]">
        {filtered.length} de {rows.length} comunicaciones
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-3 font-semibold">Qué lo dispara</th>
              <th className="py-2 pr-3 font-semibold">De</th>
              <th className="py-2 pr-3 font-semibold">Para</th>
              <th className="py-2 pr-3 font-semibold">Canales</th>
              <th className="py-2 pr-3 font-semibold">Prueba</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.key} className="border-b align-top">
                <td className="py-2 pr-3">
                  <div>{row.trigger}</div>
                  <code className="text-xs text-[var(--color-muted)]">{row.key}</code>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{ACTOR_LABEL[row.from]}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{ACTOR_LABEL[row.to]}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {row.channels.map((channel) => CHANNEL_LABEL[channel]).join(' · ')}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {row.sendable ? (
                    <button
                      type="button"
                      onClick={() => sendSample(row.key)}
                      disabled={send?.key === row.key && send.status === 'sending'}
                      className="border rounded px-2 py-1 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                    >
                      {send?.key === row.key && send.status === 'sending' ? 'Enviando…' : 'Enviarme esta'}
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">sin muestra</span>
                  )}
                  {send?.key === row.key && send.status !== 'sending' && (
                    <div
                      className={`text-xs mt-1 ${send.status === 'sent' ? 'text-[#1d6f42]' : 'text-red-600'}`}
                    >
                      {send.message}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">Ninguna comunicación coincide con estos filtros.</p>
      )}
    </div>
  )
}
