'use client'

import { useMemo, useState } from 'react'
import type { Dictionary } from '@/lib/dictionary'
import type { EventRosterRow } from '@/lib/event-tickets'

type SellerUi = Dictionary['events']['seller']
type ScanStatus = 'valid' | 'already_used' | 'not_found' | 'wrong_seller' | 'unavailable' | null

function statusText(ui: SellerUi, status: ScanStatus): string | null {
  if (status === 'valid') return ui.scanValid
  if (status === 'already_used') return ui.scanAlreadyUsed
  if (status === 'wrong_seller') return ui.scanWrongSeller
  if (status === 'not_found') return ui.scanNotFound
  if (status === 'unavailable') return ui.error
  return null
}

export default function EventRosterClient({
  eventId,
  ui,
  initialRoster,
}: {
  eventId: string
  ui: SellerUi
  initialRoster: EventRosterRow[]
}) {
  const [roster, setRoster] = useState(initialRoster)
  const [token, setToken] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanStatus>(null)

  const checkedIn = useMemo(
    () => roster.filter(row => row.state === 'redeemed').length,
    [roster],
  )

  async function reloadRoster() {
    const res = await fetch(`/api/sell/events/${encodeURIComponent(eventId)}/roster`)
    const data = await res.json() as { roster?: EventRosterRow[] }
    setRoster(data.roster ?? [])
  }

  async function scan(e: React.FormEvent) {
    e.preventDefault()
    setScanning(true)
    setScanStatus(null)
    try {
      const res = await fetch('/api/sell/events/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json() as { status?: ScanStatus }
      setScanStatus(data.status ?? (res.ok ? 'valid' : 'unavailable'))
      if (res.ok) {
        setToken('')
        await reloadRoster()
      }
    } catch {
      setScanStatus('unavailable')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <section className="border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-xl font-semibold">{ui.scanTitle}</h2>
          <form onSubmit={scan} className="mt-4">
            <label className="block text-sm font-medium">
              {ui.scanToken}
              <input
                value={token}
                onChange={e => setToken(e.target.value.trim())}
                className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] font-mono text-sm"
                placeholder="tkt_..."
              />
            </label>
            <button disabled={scanning || !token} className="mt-4 w-full bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {scanning ? ui.scanning : ui.scan}
            </button>
          </form>
          {scanStatus && (
            <p data-testid="event-scan-status" className={`mt-4 text-sm ${scanStatus === 'valid' ? 'text-green-700' : 'text-red-600'}`}>
              {statusText(ui, scanStatus)}
            </p>
          )}
        </section>

        <section className="border border-[var(--color-border)] rounded-lg p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-xl font-semibold">{ui.roster}</h2>
            <div className="text-right text-sm">
              <div><span className="text-[var(--color-muted)]">{ui.checkedInCount}:</span> <strong>{checkedIn.toLocaleString('es-MX')}</strong></div>
              <div><span className="text-[var(--color-muted)]">{ui.totalAttendees}:</span> <strong>{roster.length.toLocaleString('es-MX')}</strong></div>
            </div>
          </div>

          {roster.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{ui.empty}</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {roster.map(row => (
                <div key={row.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{row.attendee_name ?? row.attendee_email ?? row.ticket_token}</div>
                    {row.attendee_email && <div className="text-sm text-[var(--color-muted)] truncate">{row.attendee_email}</div>}
                    {row.ticket_token && <code className="mt-1 block text-xs break-all text-[var(--color-muted)]">{row.ticket_token}</code>}
                  </div>
                  <span className={`shrink-0 text-xs rounded-full px-2 py-1 ${row.state === 'redeemed' ? 'bg-green-100 text-green-700' : 'bg-[var(--color-surface-alt)] text-[var(--color-muted)]'}`}>
                    {row.state === 'redeemed' ? ui.checkedIn : row.state === 'issued' ? ui.notCheckedIn : ui.ticketMissing}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
