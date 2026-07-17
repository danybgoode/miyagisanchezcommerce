'use client'

import { useEffect, useState } from 'react'

interface PartnerGrant {
  id: string
  role: 'manager' | 'viewer'
  since: string
  partner: { id: string; code: string; name: string | null } | null
}

const ROLE_LABEL: Record<'manager' | 'viewer', string> = { manager: 'Gestor', viewer: 'Solo lectura' }

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * "Acceso de socios" — Miyagi Partners · Sprint 2 (US-2.3). Lists active
 * `partner_grants` on THIS shop (partner code/name, role, since) with a
 * per-grant revoke button, backed by GET/DELETE `/api/sell/partner-grants`.
 *
 * Self-fetching, same convention as `<ConnectAgentPanel>`'s connector-URL
 * block: a non-ok GET (404 — flag `partners.mcp_enabled` off, or no shop —
 * or any network error) leaves this hidden entirely, so the caller
 * (`Agentes.tsx`) needs zero special-casing for the flag.
 */
export default function PartnerGrantsPanel() {
  const [grants, setGrants] = useState<PartnerGrant[] | null>(null) // null = not loaded / hidden
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchGrants() {
    try {
      const res = await fetch('/api/sell/partner-grants')
      if (!res.ok) { setGrants(null); return } // 404 (flag off) or no shop — stays hidden
      const data = (await res.json().catch(() => ({}))) as { grants?: PartnerGrant[] }
      setGrants(Array.isArray(data.grants) ? data.grants : [])
    } catch {
      setGrants(null)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchGrants() }, [])

  async function revoke(grantId: string) {
    setBusyId(grantId)
    setError(null)
    try {
      const res = await fetch('/api/sell/partner-grants', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_id: grantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'No se pudo revocar el acceso.')
        return
      }
      setGrants((prev) => (prev ?? []).filter((g) => g.id !== grantId))
    } catch {
      setError('Error de red. Intenta de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  if (grants === null) return null

  return (
    <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
      <h3 className="font-semibold text-sm mb-1">Acceso de socios</h3>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Socios (promotores con credencial de agente) que pueden operar esta tienda por MCP. Puedes
        revocar el acceso en cualquier momento — se corta desde su siguiente llamada.
      </p>
      {error && <p className="text-xs text-[color:var(--danger)] mb-2">{error}</p>}
      {grants.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">Ningún socio tiene acceso a esta tienda actualmente.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-[var(--r-sm)] border border-[var(--color-border)]">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{g.partner?.name || g.partner?.code || 'Socio'}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {g.partner?.code && g.partner?.name ? `${g.partner.code} · ` : ''}
                  {ROLE_LABEL[g.role]} · desde {fmtDate(g.since)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke(g.id)}
                disabled={busyId === g.id}
                className="text-xs text-[color:var(--danger)] border border-[color:var(--danger)] rounded-[var(--r-sm)] px-2 py-1 hover:bg-gray-100 disabled:opacity-50 flex-shrink-0"
              >
                {busyId === g.id ? 'Revocando…' : 'Revocar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
