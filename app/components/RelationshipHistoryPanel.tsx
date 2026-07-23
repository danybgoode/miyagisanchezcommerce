'use client'

import { useEffect, useState } from 'react'

/**
 * Founding merchant activation operations · Sprint 2 (Story 2.3) — the
 * shared "history + evidence" expand panel both `/promotor/relaciones` and
 * `/admin/relaciones` open on a row (build contract: "each row opens history
 * and evidence"). Fetches `GET /api/promoter/relationship/[id]/history` on
 * expand (scope-checked through the same `resolveRelationshipAccess` every
 * relationship route uses — admin included, so ONE route correctly serves
 * both views).
 *
 * Also hosts the write actions a steward has (add interaction, set/complete
 * a task, reassign owner) and, for an admin caller, the stage-correction
 * form — kept in one component so admin can do everything a promoter can on
 * their own relationships plus the correction, without a second near-
 * identical panel.
 *
 * C7 fix (PR 304 review): which write controls render is now driven by the
 * CALLER'S OWN `role` for THIS relationship, returned by the history route
 * (`resolveRelationshipAccess`'s role, per-relationship — a promoter can be
 * `owner` on one row and a read-only `viewer` grant on another, so a
 * page-level `isAdmin` flag was never the right signal). A `viewer` no
 * longer sees interaction/task/owner controls the API would reject anyway,
 * and the correction form only shows for an actual `admin` role — replaces
 * the old `isAdmin` prop entirely.
 */

const INTERACTION_KIND_LABEL: Record<string, string> = {
  note: 'Nota',
  call: 'Llamada',
  whatsapp: 'WhatsApp',
  visit: 'Visita',
  email: 'Correo',
  other: 'Otro',
}

const STAGE_LABEL: Record<string, string> = {
  scouted: 'Detectado',
  qualified: 'Calificado',
  permission_granted: 'Permiso otorgado',
  preview_in_preparation: 'Vista previa en preparación',
  preview_delivered: 'Vista previa entregada',
  activation_scheduled: 'Activación agendada',
  claimed: 'Tienda reclamada',
  payments_ready: 'Pagos listos',
  three_products_live: '3+ productos publicados',
  shared_externally: 'Compartido externamente',
  first_inquiry: 'Primera consulta',
  first_sale: 'Primera venta',
  retained_30d: 'Retenido a 30 días',
}

const STAGES_FOR_CORRECTION = Object.keys(STAGE_LABEL)

type Role = 'owner' | 'admin' | 'manager' | 'viewer'

type Transition = {
  id: string
  from_stage: string | null
  to_stage: string
  to_stage_ordinal: number
  actor_type: string
  actor_id: string | null
  reason: string | null
  /** C6 fix (PR 304 review): was selected by the route but dropped here and
   *  never rendered — "each row opens history and EVIDENCE" wasn't actually
   *  met. Free-form JSONB; rendered as a compact string when present. */
  evidence_ref: unknown
  occurred_at: string
}
type Interaction = { id: string; kind: string; body: string | null; author_clerk_user_id: string; occurred_at: string }
type Task = {
  id: string
  title: string
  due_at: string | null
  assigned_to: string | null
  completed_at: string | null
  completed_by: string | null
  created_by: string
  created_at: string
}
type OwnerHistoryRow = { id: string; from_steward: string | null; to_steward: string | null; actor_clerk_user_id: string; at: string }

type HistoryResponse = {
  ok: boolean
  role: Role
  transitions: Transition[]
  interactions: Interaction[]
  tasks: Task[]
  ownerHistory: OwnerHistoryRow[]
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtEvidence(evidence: unknown): string | null {
  if (evidence === null || evidence === undefined) return null
  if (typeof evidence === 'string') return evidence
  try {
    return JSON.stringify(evidence)
  } catch {
    return null
  }
}

export default function RelationshipHistoryPanel({
  relationshipId,
  onChanged,
}: {
  relationshipId: string
  /** Called after any successful write, so the parent row can re-fetch its summary. */
  onChanged?: () => void
}) {
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${relationshipId}/history`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError('No se pudo cargar el historial.')
        return
      }
      setData(json)
    } catch {
      setError('No se pudo cargar el historial.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationshipId])

  async function afterWrite() {
    await load()
    onChanged?.()
  }

  if (loading) return <p className="text-sm text-[var(--color-muted)] py-4">Cargando historial…</p>
  if (error || !data) return <p className="text-sm text-[color:var(--danger)] py-4">{error ?? 'Error desconocido.'}</p>

  const canWrite = data.role !== 'viewer'
  const isAdmin = data.role === 'admin'

  return (
    <div className="space-y-6">
      {canWrite && (
        <>
          <InteractionForm relationshipId={relationshipId} onSaved={afterWrite} />
          <TaskForm relationshipId={relationshipId} onSaved={afterWrite} />
          <OwnerForm relationshipId={relationshipId} onSaved={afterWrite} />
        </>
      )}
      {isAdmin && <CorrectStageForm relationshipId={relationshipId} onSaved={afterWrite} />}
      {!canWrite && (
        <p className="text-xs text-[var(--color-muted)]">
          <i className="iconoir-lock" aria-hidden /> Tu acceso a este registro es de solo lectura.
        </p>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
          Etapas ({data.transitions.length})
        </h4>
        {data.transitions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Sin transiciones registradas todavía.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.transitions.map((t) => {
              const evidence = fmtEvidence(t.evidence_ref)
              return (
                <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="badge badge-info">
                    {t.from_stage ? `${STAGE_LABEL[t.from_stage] ?? t.from_stage} → ` : ''}
                    {STAGE_LABEL[t.to_stage] ?? t.to_stage}
                  </span>
                  <span className="text-[var(--color-muted)] text-xs">
                    {t.actor_type} · {fmt(t.occurred_at)}
                    {t.reason ? ` · “${t.reason}”` : ''}
                  </span>
                  {evidence && (
                    <span className="badge badge-neutral" title={evidence}>
                      <i className="iconoir-badge-check" aria-hidden /> Evidencia: {evidence}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
          Acciones ({data.tasks.length})
        </h4>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Sin acciones registradas todavía.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-2">
                <i className={t.completed_at ? 'iconoir-check-circle' : 'iconoir-circle'} aria-hidden />
                <span className={t.completed_at ? 'line-through text-[var(--color-muted)]' : ''}>{t.title}</span>
                <span className="text-[var(--color-muted)] text-xs">
                  {t.due_at ? `vence ${fmt(t.due_at)}` : 'sin fecha'}
                  {t.completed_at ? ` · completada ${fmt(t.completed_at)}` : ''}
                </span>
                {!t.completed_at && canWrite && (
                  <CompleteTaskButton relationshipId={relationshipId} taskId={t.id} onSaved={afterWrite} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
          Interacciones ({data.interactions.length})
        </h4>
        {data.interactions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Sin interacciones registradas todavía.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.interactions.map((i) => (
              <li key={i.id}>
                <span className="badge badge-neutral">{INTERACTION_KIND_LABEL[i.kind] ?? i.kind}</span>{' '}
                <span className="text-[var(--color-muted)] text-xs">{fmt(i.occurred_at)}</span>
                {i.body && <p className="mt-0.5">{i.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
          Historial de dueño ({data.ownerHistory.length})
        </h4>
        {data.ownerHistory.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Sin reasignaciones todavía.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.ownerHistory.map((o) => (
              <li key={o.id} className="text-[var(--color-muted)] text-xs">
                {o.from_steward ?? 'sin dueño'} → {o.to_steward ?? 'sin dueño'} · {fmt(o.at)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function InteractionForm({ relationshipId, onSaved }: { relationshipId: string; onSaved: () => void }) {
  const [kind, setKind] = useState('note')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${relationshipId}/interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'No se pudo guardar.')
        return
      }
      setBody('')
      onSaved()
    } catch {
      setError('No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">Agregar interacción</p>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input w-auto">
          {Object.entries(INTERACTION_KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="¿Qué pasó?"
          className="input flex-1 min-w-[12rem]"
        />
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={submit}>
          Guardar
        </button>
      </div>
      {error && <p className="text-xs text-[color:var(--danger)] mt-1">{error}</p>}
    </div>
  )
}

function TaskForm({ relationshipId, onSaved }: { relationshipId: string; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!title.trim()) {
      setError('El título es obligatorio.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${relationshipId}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, dueAt: dueAt || undefined }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'No se pudo guardar.')
        return
      }
      setTitle('')
      setDueAt('')
      onSaved()
    } catch {
      setError('No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">Agregar próxima acción</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Llamar para confirmar entrega"
          className="input flex-1 min-w-[12rem]"
        />
        <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input w-auto" />
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={submit}>
          Guardar
        </button>
      </div>
      {!dueAt && (
        <p className="text-xs text-[var(--color-muted)] mt-1">
          Sin fecha, esta acción NO cuenta como "próxima acción programada" en el listado.
        </p>
      )}
      {error && <p className="text-xs text-[color:var(--danger)] mt-1">{error}</p>}
    </div>
  )
}

function CompleteTaskButton({ relationshipId, taskId, onSaved }: { relationshipId: string; taskId: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // C5 fix (PR 304 review): a 403/404/500 used to be ignored — `onSaved()`
  // ran regardless, which re-fetched history and made a REJECTED complete
  // read as a successful refresh while the task silently stayed open.
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${relationshipId}/task/${taskId}/complete`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? 'No se pudo completar la acción.')
        return
      }
      onSaved()
    } catch {
      setError('No se pudo completar la acción.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={submit}>
        Completar
      </button>
      {error && <span className="text-xs text-[color:var(--danger)]">{error}</span>}
    </span>
  )
}

function OwnerForm({ relationshipId, onSaved }: { relationshipId: string; onSaved: () => void }) {
  const [toSteward, setToSteward] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  // C4 fix (PR 304 review): a 200 with `ownerHistoryRecorded: false` used to
  // be treated as a plain success — the reassignment DID happen (the primary
  // write can't be rolled back), but the audit trail silently didn't, and
  // nothing told the human that.
  async function submit() {
    setBusy(true)
    setError(null)
    setWarning(null)
    try {
      const res = await fetch(`/api/promoter/relationship/${relationshipId}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toSteward: toSteward || null }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'No se pudo reasignar.')
        return
      }
      if (json.ownerHistoryRecorded === false) {
        setWarning('El dueño se reasignó, pero no se pudo guardar el historial de auditoría. Avisa a un administrador.')
      }
      onSaved()
    } catch {
      setError('No se pudo reasignar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">Reasignar dueño</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={toSteward}
          onChange={(e) => setToSteward(e.target.value)}
          placeholder="ID de Clerk del nuevo dueño (vacío = sin dueño)"
          className="input flex-1 min-w-[12rem]"
        />
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={submit}>
          Reasignar
        </button>
      </div>
      {warning && <p className="text-xs text-[color:var(--warning)] mt-1">{warning}</p>}
      {error && <p className="text-xs text-[color:var(--danger)] mt-1">{error}</p>}
    </div>
  )
}

function CorrectStageForm({ relationshipId, onSaved }: { relationshipId: string; onSaved: () => void }) {
  const [toStage, setToStage] = useState('scouted')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  // C4 fix (PR 304 review): a 200 with `stageMirrorUpdated: false` used to be
  // treated as a plain success — the CORRECTION (the audit truth) is already
  // committed at that point, but the relationship's `stage` mirror the views
  // read didn't follow, and nothing told the human the displayed stage may
  // now be stale.
  async function submit() {
    if (!reason.trim()) {
      setError('La corrección requiere una razón.')
      return
    }
    setBusy(true)
    setError(null)
    setWarning(null)
    try {
      const res = await fetch(`/api/admin/relationship/${relationshipId}/correct-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage, reason }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'No se pudo corregir la etapa.')
        return
      }
      if (json.stageMirrorUpdated === false) {
        setWarning('La corrección se registró, pero la etapa mostrada no se pudo actualizar. Recarga en unos minutos.')
      }
      setReason('')
      onSaved()
    } catch {
      setError('No se pudo corregir la etapa.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--warning)] mb-2">
        <i className="iconoir-warning-triangle" aria-hidden /> Corregir etapa (solo admin)
      </p>
      <div className="flex flex-wrap gap-2">
        <select value={toStage} onChange={(e) => setToStage(e.target.value)} className="input w-auto">
          {STAGES_FOR_CORRECTION.map((s) => (
            <option key={s} value={s}>{STAGE_LABEL[s]}</option>
          ))}
        </select>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Razón (obligatoria)"
          className="input flex-1 min-w-[12rem]"
        />
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={submit}>
          Corregir
        </button>
      </div>
      {warning && <p className="text-xs text-[color:var(--warning)] mt-1">{warning}</p>}
      {error && <p className="text-xs text-[color:var(--danger)] mt-1">{error}</p>}
    </div>
  )
}

export { STAGE_LABEL }
