'use client'

import { useMemo, useState } from 'react'
import type { FlagPolarity } from '@/lib/flags-admin'
import { sortFlagsByKey, paginate } from '@/lib/flags-admin-view'

const PAGE_SIZE = 15

/** One flag as rendered on the admin surface (page-merged: DB row ∪ known-flag default). */
export type FlagView = {
  key: string
  polarity: FlagPolarity
  enabled: boolean
  /** True while no `platform_flags` row exists yet — the live value is the fail-open default. */
  isDefault: boolean
  description: string | null
  updated_at: string | null
  updated_by: string | null
}

/**
 * Feature-flag control surface (epic 09 · feature-flags-inhouse, Sprint 2). **Clerk-gated**
 * — the same-origin POST carries the session cookie; no auth header. Each toggle writes to
 * `platform_flags` via `/api/admin/flags`; the change propagates to both apps within one
 * cache TTL (~60 s, no redeploy). Flipping `checkout.stripe_enabled` is a money path, so it
 * confirms first.
 */
export default function FlagsAdminClient({ initialFlags }: { initialFlags: FlagView[] }) {
  const [flags, setFlags] = useState<FlagView[]>(initialFlags)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  // Alphabetical by default — the list has grown past 25+ flags across many
  // epics with no consistent order otherwise (insertion order = whenever each
  // flag happened to be added).
  const sorted = useMemo(() => sortFlagsByKey(flags), [flags])
  const { pageItems, totalPages, page: currentPage } = useMemo(
    () => paginate(sorted, page, PAGE_SIZE),
    [sorted, page],
  )

  async function toggle(flag: FlagView) {
    const next = !flag.enabled
    // Money path: killing the Stripe rail everywhere warrants an explicit confirm.
    if (flag.key === 'checkout.stripe_enabled' && next === false) {
      const ok = window.confirm(
        'Vas a APAGAR el checkout con Stripe en toda la plataforma. ¿Continuar?',
      )
      if (!ok) return
    }
    setBusyKey(flag.key)
    setError(null)
    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: flag.key, enabled: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo actualizar la flag.')
        return
      }
      // Reflect the new state: the row now exists, so it's no longer "por defecto".
      setFlags((prev) =>
        prev.map((f) =>
          f.key === flag.key
            ? { ...f, enabled: next, isDefault: false, updated_at: new Date().toISOString() }
            : f,
        ),
      )
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

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: 'var(--fg)' }}>Flags</h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: 14, margin: '0 0 8px' }}>
        Prende y apaga funciones de la plataforma sin redeploy. Cada cambio queda en la
        Auditoría.
      </p>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13, margin: '0 0 24px' }}>
        Los cambios tardan hasta ~60 s en aplicarse (caché en memoria). Si el almacén de flags
        no responde, cada función usa su valor por defecto (a prueba de fallos).
      </p>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 14, margin: '0 0 16px' }}>{error}</p>
      )}

      <p style={{ color: 'var(--fg-muted)', fontSize: 12, margin: '0 0 8px' }}>
        {sorted.length} flags · orden alfabético · página {currentPage} de {totalPages}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Flag</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Tipo</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Estado</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Último cambio</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((f) => (
              <tr key={f.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ fontFamily: 'var(--font-mono, monospace)' }}>{f.key}</div>
                  {f.description && (
                    <div style={{ color: 'var(--fg-muted)', marginTop: 2 }}>{f.description}</div>
                  )}
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--fg-muted)' }}>
                  {f.polarity === 'killswitch' ? 'Kill-switch' : 'Activación'}
                </td>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 600, color: f.enabled ? 'var(--fg)' : 'var(--fg-muted)' }}>
                    {f.enabled ? 'Activa' : 'Apagada'}
                  </span>
                  {f.isDefault && (
                    <span style={{ color: 'var(--fg-muted)' }}> · por defecto</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--fg-muted)' }}>
                  <div>{fmt(f.updated_at)}</div>
                  {f.updated_by && <div style={{ fontSize: 12 }}>{f.updated_by}</div>}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <button
                    onClick={() => toggle(f)}
                    disabled={busyKey === f.key}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: busyKey === f.key ? 'default' : 'pointer',
                      opacity: busyKey === f.key ? 0.5 : 1,
                      background: 'transparent',
                      color: 'var(--fg)',
                    }}
                  >
                    {busyKey === f.key ? '…' : f.enabled ? 'Apagar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={currentPage <= 1}
            style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 13,
              fontWeight: 600, background: 'transparent', color: 'var(--fg)',
              cursor: currentPage <= 1 ? 'default' : 'pointer', opacity: currentPage <= 1 ? 0.4 : 1,
            }}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            Página {currentPage} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={currentPage >= totalPages}
            style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 13,
              fontWeight: 600, background: 'transparent', color: 'var(--fg)',
              cursor: currentPage >= totalPages ? 'default' : 'pointer', opacity: currentPage >= totalPages ? 0.4 : 1,
            }}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}
