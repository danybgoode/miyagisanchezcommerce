'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MlHealth, MlHealthState } from '@/lib/ml-health'
import type { SanitizedMlConnection } from '@/lib/ml-connection'

/**
 * Mercado Libre connection status + actions (US-3). Presentational client island:
 * shows the health badge + nickname, and drives Conectar (a plain link to the
 * OAuth start) / Reconectar / Desconectar. No token is ever present here.
 */

const STATE_STYLE: Record<MlHealthState, { color: string; bg: string; dot: string }> = {
  connected: { color: 'var(--success)', bg: 'var(--success-soft)', dot: 'var(--success)' },
  stale: { color: 'var(--warning)', bg: 'var(--warning-soft)', dot: 'var(--warning)' },
  expired: { color: 'var(--danger)', bg: 'var(--danger-soft)', dot: 'var(--danger)' },
  disconnected: { color: 'var(--fg-muted)', bg: 'var(--bg-sunk)', dot: 'var(--fg-subtle)' },
}

const ERROR_COPY: Record<string, string> = {
  oauth_state: 'No pudimos validar la sesión de conexión. Vuelve a intentarlo.',
  oauth_failed: 'Mercado Libre rechazó la conexión. Vuelve a intentarlo.',
  ml_no_config: 'La integración con Mercado Libre aún no está configurada. Contacta a soporte.',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

export default function MercadoLibreStatus({
  connection,
  health,
  error,
  justConnected,
  importEnabled = false,
}: {
  connection: SanitizedMlConnection | null
  health: MlHealth
  error: string | null
  justConnected: boolean
  importEnabled?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isConnected = !!connection && connection.status === 'connected'
  const style = STATE_STYLE[health.state] ?? STATE_STYLE.disconnected

  async function disconnect() {
    if (busy) return
    if (!confirm('¿Desconectar tu cuenta de Mercado Libre? Tendrás que volver a autorizarla para sincronizar.')) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/sell/ml/disconnect', { method: 'DELETE' })
      if (!res.ok) throw new Error('disconnect_failed')
      router.refresh()
    } catch {
      setActionError('No se pudo desconectar. Vuelve a intentarlo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 14 }}>
          {ERROR_COPY[error] ?? 'Ocurrió un error al conectar con Mercado Libre.'}
        </div>
      )}
      {justConnected && isConnected && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--success-soft)', color: 'var(--success)', fontSize: 14 }}>
          ¡Listo! Tu cuenta de Mercado Libre quedó conectada.
        </div>
      )}

      {/* Status card */}
      <div
        style={{
          padding: 18,
          borderRadius: 'var(--r-lg)',
          border: '1.5px solid var(--border)',
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isConnected ? 14 : 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: style.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: style.color }}>{health.label_es}</span>
        </div>

        {isConnected ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 14, margin: 0 }}>
            <dt style={{ color: 'var(--fg-muted)' }}>Cuenta</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{connection?.ml_nickname ?? connection?.ml_user_id}</dd>
            <dt style={{ color: 'var(--fg-muted)' }}>Última renovación</dt>
            <dd style={{ margin: 0 }}>{fmtDate(connection?.last_refreshed_at ?? null)}</dd>
            <dt style={{ color: 'var(--fg-muted)' }}>Vence</dt>
            <dd style={{ margin: 0 }}>{fmtDate(connection?.expires_at ?? null)}</dd>
          </dl>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--fg-muted)', margin: '8px 0 0' }}>
            Aún no has conectado tu cuenta de Mercado Libre.
          </p>
        )}
      </div>

      {actionError && (
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>{actionError}</div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {isConnected ? (
          <>
            {importEnabled && (
              <a
                href="/shop/manage/mercadolibre/import"
                style={{
                  padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
                  background: 'var(--accent)', color: 'var(--fg-inverse)', textDecoration: 'none',
                }}
              >
                Importar mi catálogo
              </a>
            )}
            <a
              href="/api/sell/ml/connect"
              style={{
                padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
                border: '1.5px solid var(--border)', color: 'var(--fg)', textDecoration: 'none',
              }}
            >
              Reconectar
            </a>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              style={{
                padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
                border: '1.5px solid var(--danger)', color: 'var(--danger)', background: 'transparent',
                cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Desconectando…' : 'Desconectar'}
            </button>
          </>
        ) : (
          <a
            href="/api/sell/ml/connect"
            style={{
              padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
              background: 'var(--accent)', color: 'var(--fg-inverse)', textDecoration: 'none',
            }}
          >
            Conectar Mercado Libre
          </a>
        )}
      </div>
    </div>
  )
}
