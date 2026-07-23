'use client'

import { useEffect, useState } from 'react'
import { STAGE_LABEL } from '@/app/components/RelationshipHistoryPanel'

/**
 * Founding merchant activation operations · Sprint 3 (Story 3.3) — the
 * reconciliation view. Thin screen over `GET /api/admin/relationships/
 * reconciliation` (source fact / projected stage / last evaluation /
 * delivery state per relationship) and `POST /api/admin/relationship/[id]/
 * replay` (re-run the adapter + resolver for one row, same dedupe key —
 * repairs without duplicating).
 */

type SourceFacts = {
  claimed?: boolean
  paymentsReady?: boolean
  threeProductsLive?: boolean
  firstSale?: boolean
  retained30d?: boolean
}

type Emission = { eventType: string; deliveredAt: string | null; attempts: number; lastError: string | null }

type ReconciliationRow = {
  id: string
  businessName: string
  projectedStage: string
  lastEvaluatedAt: string | null
  sourceFacts: SourceFacts
  factsDegraded: boolean
  emissions: Emission[]
}

const FACT_LABEL: Record<keyof SourceFacts, string> = {
  claimed: 'Reclamada',
  paymentsReady: 'Pagos listos',
  threeProductsLive: '3+ productos',
  firstSale: 'Primera venta',
  retained30d: 'Retenido 30d',
}

function fmt(iso: string | null): string {
  if (!iso) return 'Nunca'
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminConciliacionClient() {
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [replayMessage, setReplayMessage] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/relationships/reconciliation')
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError('No se pudo cargar la conciliación.')
        return
      }
      setRows(json.rows ?? [])
    } catch {
      setError('No se pudo cargar la conciliación.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function replay(id: string) {
    setReplayingId(id)
    setReplayMessage(null)
    try {
      const res = await fetch(`/api/admin/relationship/${id}/replay`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setReplayMessage('No se pudo repetir la evaluación.')
        return
      }
      const advanced = json.outcome?.advanced ?? []
      setReplayMessage(
        advanced.length > 0
          ? `Avanzó a: ${advanced.map((s: string) => STAGE_LABEL[s] ?? s).join(' → ')}`
          : 'Sin cambios — los hechos actuales no adelantan la etapa.',
      )
      await load()
    } catch {
      setReplayMessage('No se pudo repetir la evaluación.')
    } finally {
      setReplayingId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Conciliación de hitos</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Hecho de origen, etapa proyectada, última evaluación y estado de entrega a Golden Beans. Repite la
          evaluación de un registro para reparar un hecho tardío sin duplicar nada.
        </p>
      </div>

      {replayMessage && <p className="text-sm text-[var(--color-fg)]">{replayMessage}</p>}
      {loading && <p className="text-sm text-[var(--color-muted)]">Cargando…</p>}
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{r.businessName}</span>
              <span className="badge badge-info">{STAGE_LABEL[r.projectedStage] ?? r.projectedStage}</span>
              <span className="text-xs text-[var(--color-muted)] flex items-center gap-1">
                <i className="iconoir-clock" aria-hidden />
                Última evaluación: {fmt(r.lastEvaluatedAt)}
              </span>
              {r.factsDegraded && (
                <span className="badge badge-warning flex items-center gap-1">
                  <i className="iconoir-warning-triangle" aria-hidden />
                  Lectura de Medusa incompleta ahora mismo
                </span>
              )}
              <button
                type="button"
                onClick={() => replay(r.id)}
                disabled={replayingId === r.id}
                className="ml-auto btn btn-secondary btn-sm flex items-center gap-1"
              >
                <i className="iconoir-refresh" aria-hidden />
                {replayingId === r.id ? 'Reevaluando…' : 'Reevaluar'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {(Object.keys(FACT_LABEL) as Array<keyof SourceFacts>).map((key) => {
                const value = r.sourceFacts[key]
                if (value === undefined) return null
                return (
                  <span key={key} className={`badge ${value ? 'badge-success' : 'badge-neutral'}`}>
                    {FACT_LABEL[key]}: {value ? 'sí' : 'no'}
                  </span>
                )
              })}
              {Object.values(r.sourceFacts).every((v) => v === undefined) && (
                <span className="text-[var(--color-muted)]">Sin hechos comerciales todavía (sin tienda vinculada).</span>
              )}
            </div>

            {r.emissions.length > 0 && (
              <div className="text-xs space-y-1">
                <p className="text-[var(--color-muted)]">Entregas a Golden Beans:</p>
                <ul className="space-y-0.5">
                  {r.emissions.map((e) => (
                    <li key={e.eventType} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{e.eventType}</span>
                      {e.deliveredAt ? (
                        <span className="badge badge-success flex items-center gap-1">
                          <i className="iconoir-check-circle" aria-hidden />
                          Entregado {fmt(e.deliveredAt)}
                        </span>
                      ) : (
                        <span className="badge badge-warning">Pendiente ({e.attempts} intento{e.attempts === 1 ? '' : 's'})</span>
                      )}
                      {e.lastError && <span className="text-[color:var(--danger)]">{e.lastError}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-[var(--color-muted)] py-8 text-center">No hay registros todavía.</p>
        )}
      </div>
    </div>
  )
}
