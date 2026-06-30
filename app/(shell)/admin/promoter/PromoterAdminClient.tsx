'use client'

import { useState } from 'react'
import type { Promoter, PromoterSettings, PromoterAttribution } from '@/lib/promoter'

/**
 * Promoter console — provision promoters + edit the seller discount, over
 * `GET/POST/PATCH /api/admin/promoter`. **Clerk-gated** (same-origin requests carry
 * the session cookie). The feature stays hidden behind the `promoter.enabled` flag;
 * this admin screen only manages the data.
 *
 * `discount_amount_cents` is reused for both discount types: pesos (×100) when
 * `fixed`, a raw percentage when `percentage` — the input adapts its label.
 */
export default function PromoterAdminClient({
  initialPromoters,
  initialSettings,
  siteUrl,
}: {
  initialPromoters: Promoter[]
  initialSettings: PromoterSettings
  siteUrl: string
}) {
  const [promoters, setPromoters] = useState<Promoter[]>(initialPromoters)
  const [settings, setSettings] = useState<PromoterSettings>(initialSettings)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // Per-promoter attribution ledger (lazy-loaded on expand).
  const [openId, setOpenId] = useState<string | null>(null)
  const [attributions, setAttributions] = useState<Record<string, PromoterAttribution[]>>({})
  const [loadingAttrs, setLoadingAttrs] = useState<string | null>(null)

  async function toggleAttributions(promoterId: string) {
    if (openId === promoterId) { setOpenId(null); return }
    setOpenId(promoterId)
    if (attributions[promoterId]) return // cached
    setLoadingAttrs(promoterId)
    try {
      const res = await fetch(`/api/admin/promoter/attributions?promoterId=${encodeURIComponent(promoterId)}`)
      const data = await res.json().catch(() => ({}))
      setAttributions((m) => ({ ...m, [promoterId]: data.attributions ?? [] }))
    } finally {
      setLoadingAttrs((id) => (id === promoterId ? null : id))
    }
  }

  const isFixed = settings.discount_type === 'fixed'
  const amountDisplay = isFixed ? settings.discount_amount_cents / 100 : settings.discount_amount_cents

  function setAmountFromDisplay(value: number) {
    const cents = isFixed ? Math.round(value * 100) : Math.round(value)
    setSettings((s) => ({ ...s, discount_amount_cents: cents }))
  }

  function shareLink(code: string) {
    return `${siteUrl}/vende?promo=${code}`
  }

  async function createPromoter() {
    setCreating(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/promoter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.promoter) {
        setMsg(data?.error ?? 'No se pudo crear el promotor.')
        return
      }
      setPromoters((list) => [data.promoter, ...list])
      setName('')
      setMsg('Promotor creado.')
    } finally {
      setCreating(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/promoter', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo guardar.')
        return
      }
      if (data.settings) setSettings(data.settings)
      setMsg('Descuento guardado.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(shareLink(code))
      setCopied(code)
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
    } catch {
      /* clipboard unavailable — the link is visible to copy by hand */
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Promotores</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Provisiona promotores y configura el descuento que su código ofrece a la tienda. Los cambios aplican sin redeploy.
        </p>
      </div>

      {/* Provision a new promoter */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nuevo promotor</h2>
        <div className="flex items-end gap-3">
          <label className="block text-sm flex-1">
            Nombre (opcional)
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. María — zona centro"
              className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
            />
          </label>
          <button
            onClick={createPromoter}
            disabled={creating}
            className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {creating ? 'Creando…' : 'Crear promotor'}
          </button>
        </div>
      </section>

      {/* Promoter list with code + share link */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Promotores ({promoters.length})</h2>
        {promoters.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Aún no hay promotores.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {promoters.map((p) => (
              <li key={p.id} className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-mono font-semibold">{p.code}</span>
                    {p.name && <span className="text-sm text-[var(--color-muted)] ml-2">{p.name}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAttributions(p.id)}
                      className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-surface)]"
                    >
                      {openId === p.id ? 'Ocultar' : 'Atribuciones'}
                    </button>
                    <button
                      onClick={() => copy(p.code)}
                      className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-surface)]"
                    >
                      {copied === p.code ? 'Copiado' : 'Copiar liga'}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-[var(--color-muted)] font-mono break-all">{shareLink(p.code)}</div>
                {openId === p.id && (
                  <div className="mt-2 rounded-lg bg-[var(--color-surface)] p-2 text-xs">
                    {loadingAttrs === p.id ? (
                      <p className="text-[var(--color-muted)]">Cargando…</p>
                    ) : (attributions[p.id]?.length ?? 0) === 0 ? (
                      <p className="text-[var(--color-muted)]">Sin atribuciones todavía.</p>
                    ) : (
                      <ul className="space-y-1">
                        {attributions[p.id].map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2">
                            <span className="font-mono">{a.sku ?? '—'}</span>
                            <span className="text-[var(--color-muted)] truncate">{a.seller_id ?? '—'}</span>
                            <span className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5">{a.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Discount settings */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Descuento del promotor</h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Descuento de promotor activo
        </label>

        <label className="block text-sm">
          Tipo de descuento
          <select
            value={settings.discount_type}
            onChange={(e) => setSettings((s) => ({ ...s, discount_type: e.target.value as PromoterSettings['discount_type'] }))}
            className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
          >
            <option value="fixed">Monto fijo (MXN)</option>
            <option value="percentage">Porcentaje (%)</option>
          </select>
        </label>

        <label className="block text-sm">
          {isFixed ? 'Monto (MXN)' : 'Porcentaje (%)'}
          <input
            type="number"
            min={0}
            value={amountDisplay}
            onChange={(e) => setAmountFromDisplay(Number(e.target.value))}
            className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {savingSettings ? 'Guardando…' : 'Guardar descuento'}
          </button>
          {msg && <span className="text-sm text-[var(--color-muted)]">{msg}</span>}
        </div>
      </section>
    </div>
  )
}
