'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Banner } from '@/components/feedback/Banner'
import type { FlagPolarity } from '@/lib/flags-admin'

/** One flag as rendered on the admin surface (page-merged: DB row ∪ known-flag default). */
export type FlagView = {
  key: string
  polarity: FlagPolarity
  criticality: 'low' | 'medium' | 'high'
  enabled: boolean
  definitionVersion: number
  reason: 'STATIC'
  environment: 'development' | 'preview' | 'production'
  snapshotVersion: number
  snapshotUpdatedAt: string | null
  /** Only used by the shared deterministic sort helper; Golden owns the source timestamp. */
  updated_at: string | null
  description: string
}

/**
 * Feature-flag control surface (epic 09 · feature-flags-inhouse, Sprint 2; restyled
 * onto the shared Button/StatusBadge/Banner primitives + filter/sort/pagination moved
 * server-side — admin-flags-cleanup fast-follow chore). **Clerk-gated** — the
 * same-origin POST carries the session cookie; no auth header. Each toggle requires a reason and
 * an optimistic Golden snapshot version, so the familiar surface cannot overwrite a newer change.
 * Flipping `checkout.stripe_enabled` is a money path, so it confirms first.
 *
 * Receives only the CURRENT PAGE's already-filtered/sorted slice — `page.tsx` owns
 * search/filter/sort/pagination now (URL-search-param-driven, mirrors
 * `/shop/manage/catalogo`). After a successful toggle this calls `router.refresh()`
 * rather than patching local state, so a toggle that would change which filter/status
 * bucket a flag belongs to (e.g. flipping it while the "Apagadas" chip is active)
 * re-derives the view from the server instead of leaving a stale row in view.
 */
export default function FlagsAdminClient({ flags }: { flags: FlagView[] }) {
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(flag: FlagView) {
    const next = !flag.enabled
    // Money path: killing the Stripe rail everywhere warrants an explicit confirm.
    if (flag.key === 'checkout.stripe_enabled' && next === false) {
      const ok = window.confirm(
        'Vas a APAGAR el checkout con Stripe en toda la plataforma. ¿Continuar?',
      )
      if (!ok) return
    }
    const reason = window.prompt('Motivo del cambio (queda auditado en Golden):')?.trim()
    if (!reason) return
    setBusyKey(flag.key)
    setError(null)
    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: flag.key,
          enabled: next,
          expectedSnapshotVersion: flag.snapshotVersion,
          reason,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo actualizar la flag.')
        return
      }
      router.refresh()
    } catch {
      setError('Error de red al actualizar la flag.')
    } finally {
      setBusyKey(null)
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
      : '—'

  if (flags.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-muted)] py-6 text-center">
        Ninguna flag coincide con estos filtros.
      </p>
    )
  }

  return (
    <div>
      {error && (
        <Banner variant="danger" className="mb-4">{error}</Banner>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left border-b border-[var(--color-border)]">
              <th className="px-3 py-2 font-semibold">Flag</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold">Último cambio</th>
              <th className="px-3 py-2 font-semibold">Acción</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.key} className="border-b border-[var(--color-border)]">
                <td className="px-3 py-2">
                  <div className="font-mono">{f.key}</div>
                  {f.description && (
                    <div className="text-[var(--fg-muted)] mt-0.5">{f.description}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge token={f.polarity === 'killswitch' ? 'info' : 'neutral'}>
                    {f.polarity === 'killswitch' ? 'Kill-switch' : 'Activación'}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusBadge token={f.enabled ? 'success' : 'neutral'}>
                    {f.enabled ? 'Activa' : 'Apagada'}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--fg-muted)]">
                  <div>{fmt(f.snapshotUpdatedAt)}</div>
                  <div className="text-xs">v{f.definitionVersion} · {f.environment} · {f.reason} · fresca</div>
                  <div className="text-xs">riesgo {f.criticality}</div>
                </td>
                <td className="px-3 py-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => toggle(f)}
                    disabled={busyKey === f.key}
                  >
                    {busyKey === f.key ? '…' : f.enabled ? 'Apagar' : 'Activar'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
