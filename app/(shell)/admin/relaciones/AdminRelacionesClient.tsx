'use client'

import { useEffect, useMemo, useState } from 'react'
import RelationshipHistoryPanel, { STAGE_LABEL } from '@/app/components/RelationshipHistoryPanel'

/**
 * Founding merchant activation operations · Sprint 2 (Story 2.3) — the admin
 * cohort view. Thin screen over `GET /api/admin/relationships` (filters:
 * stage, steward, blocker, missing_action, overdue) — each row expands into
 * the SAME `RelationshipHistoryPanel` the promoter view uses, with
 * `isAdmin` on so the stage-correction form shows.
 */

type EnrichedRelationship = {
  id: string
  businessName: string
  stewardClerkUserId: string | null
  estado: string | null
  municipio: string | null
  stage: string
  stageEnteredAt: string
  ageInStageDays: number
  nextAction: { id: string; dueAt: string | null } | null
  missingAction: boolean
  overdue: boolean
  blocker: boolean
  consentState: string
}

const CONSENT_LABEL: Record<string, string> = {
  sin_vista_previa: 'Sin vista previa',
  vista_previa_draft: 'Vista previa en borrador',
  vista_previa_approved: 'Vista previa aprobada',
  vista_previa_changes_requested: 'Cambios solicitados',
  vista_previa_invalidated: 'Vista previa invalidada',
  vista_previa_activated: 'Vista previa activada',
}

type TriFilter = '' | 'true' | 'false'

export default function AdminRelacionesClient() {
  const [rows, setRows] = useState<EnrichedRelationship[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [stage, setStage] = useState('')
  const [steward, setSteward] = useState('')
  const [blocker, setBlocker] = useState<TriFilter>('')
  const [missingAction, setMissingAction] = useState<TriFilter>('')
  const [overdue, setOverdue] = useState<TriFilter>('')

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (stage) params.set('stage', stage)
    if (steward.trim()) params.set('steward', steward.trim())
    if (blocker) params.set('blocker', blocker)
    if (missingAction) params.set('missing_action', missingAction)
    if (overdue) params.set('overdue', overdue)
    return params.toString()
  }, [stage, steward, blocker, missingAction, overdue])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/relationships${query ? `?${query}` : ''}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError('No se pudo cargar el cohorte.')
        return
      }
      setRows(json.relationships ?? [])
    } catch {
      setError('No se pudo cargar el cohorte.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Comercios fundadores</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Cohorte completo: etapa, dueño, próxima acción, consentimiento y bloqueos. Filtra y abre un registro para
          ver su historial completo o corregir su etapa.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="input w-auto">
          <option value="">Todas las etapas</option>
          {Object.entries(STAGE_LABEL).map(([s, label]) => (
            <option key={s} value={s}>{label}</option>
          ))}
        </select>
        <input
          type="text"
          value={steward}
          onChange={(e) => setSteward(e.target.value)}
          placeholder="ID de Clerk del dueño…"
          className="input w-auto"
        />
        <TriSelect label="Bloqueo" value={blocker} onChange={setBlocker} />
        <TriSelect label="Sin próxima acción" value={missingAction} onChange={setMissingAction} />
        <TriSelect label="Vencido" value={overdue} onChange={setOverdue} />
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
      </p>

      {loading && <p className="text-sm text-[var(--color-muted)]">Cargando…</p>}
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}

      <div className="space-y-2">
        {rows.map((r) => {
          const open = r.id === expandedId
          return (
            <div key={r.id} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : r.id)}
                className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-[var(--color-surface-alt)]"
                aria-expanded={open}
              >
                <span className="font-medium">{r.businessName}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {[r.municipio, r.estado].filter(Boolean).join(', ')}
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                  <span className="badge badge-info">{STAGE_LABEL[r.stage] ?? r.stage}</span>
                  <span className="text-[var(--color-muted)]">{r.ageInStageDays}d</span>
                  <span className="text-[var(--color-muted)]">
                    {r.stewardClerkUserId ? `Dueño: ${r.stewardClerkUserId}` : 'Sin dueño'}
                  </span>
                  {r.missingAction ? (
                    <span className="badge badge-warning">Sin próxima acción</span>
                  ) : (
                    <span className={`badge ${r.overdue ? 'badge-danger' : 'badge-success'}`}>
                      {r.overdue ? 'Vencido' : 'Al día'}
                    </span>
                  )}
                  {r.blocker && <span className="badge badge-danger">Bloqueo</span>}
                  <span className="badge badge-neutral">{CONSENT_LABEL[r.consentState] ?? r.consentState}</span>
                </span>
              </button>

              {open && (
                <div className="border-t border-[var(--color-border)] px-4 py-4 bg-[var(--color-surface-alt)]">
                  <RelationshipHistoryPanel relationshipId={r.id} isAdmin onChanged={load} />
                </div>
              )}
            </div>
          )
        })}

        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-[var(--color-muted)] py-8 text-center">Ningún registro coincide con los filtros.</p>
        )}
      </div>
    </div>
  )
}

function TriSelect({ label, value, onChange }: { label: string; value: TriFilter; onChange: (v: TriFilter) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as TriFilter)} className="input w-auto">
      <option value="">{label}: todos</option>
      <option value="true">{label}: sí</option>
      <option value="false">{label}: no</option>
    </select>
  )
}
