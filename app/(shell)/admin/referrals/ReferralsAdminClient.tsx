'use client'

import { useState } from 'react'
import type { ReferralSettings } from '@/lib/referrals'

/**
 * Referrals reward config — a thin screen over `GET/PATCH
 * /api/admin/referrals/config` (S2.2). No backend change; this just replaces the
 * curl-only config with an editable form. **Clerk-gated** — the same-origin
 * PATCH carries the session cookie.
 *
 * `reward_amount_cents` is reused for both reward types: pesos (×100) when
 * `fixed`, a raw percentage when `percentage` — the input adapts its label.
 */
export default function ReferralsAdminClient({
  initialSettings,
}: {
  initialSettings: ReferralSettings
}) {
  const [settings, setSettings] = useState<ReferralSettings>(initialSettings)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const isFixed = settings.reward_type === 'fixed'
  // For the fixed reward, the amount field is pesos (cents / 100); for the
  // percentage reward it is the raw percent stored in the same column.
  const amountDisplay = isFixed ? settings.reward_amount_cents / 100 : settings.reward_amount_cents

  function setAmountFromDisplay(value: number) {
    const cents = isFixed ? Math.round(value * 100) : Math.round(value)
    setSettings((s) => ({ ...s, reward_amount_cents: cents }))
  }

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/referrals/config', {
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
      setMsg('Guardado.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Referidos</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Configura la recompensa por referir. Los cambios aplican sin redeploy.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        Programa de referidos activo
      </label>

      <label className="block text-sm">
        Tipo de recompensa
        <select
          value={settings.reward_type}
          onChange={(e) => setSettings((s) => ({ ...s, reward_type: e.target.value as ReferralSettings['reward_type'] }))}
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

      <label className="block text-sm">
        Vigencia de la recompensa (días)
        <input
          type="number"
          min={1}
          value={settings.reward_expiry_days}
          onChange={(e) => setSettings((s) => ({ ...s, reward_expiry_days: Math.round(Number(e.target.value)) }))}
          className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        {msg && <span className="text-sm text-[var(--color-muted)]">{msg}</span>}
      </div>
    </div>
  )
}
