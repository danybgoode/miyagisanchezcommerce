'use client'

import { useState } from 'react'
import type { TenantRow } from '@/lib/admin/tenant-directory'
import { statusChangeConfirmation } from '@/lib/admin/tenant-actions'
import { sellerStatusLabel, type SellerStatus } from '@/lib/seller-status'

/**
 * Pause, reactivate and remove a shop (tenant-lifecycle-admin · S3.3).
 *
 * Three properties this component is responsible for, all of them about honesty:
 *
 *  1. **The confirmation names the consequence.** "¿Seguro?" tells nobody what is
 *     about to happen, so the copy comes from `statusChangeConfirmation` and says
 *     what pausing does versus what removing does.
 *  2. **A reason is required before the button enables.** The audit row is the only
 *     record of why a shop went dark, and "paused by admin" with no cause is what
 *     makes an incident six months later unresolvable.
 *  3. **A partial outcome is reported as partial.** When the backend replays a
 *     reactivation and cannot restore everything, it answers `complete: false` with
 *     the product ids it could not reach — and this says so instead of "listo".
 */
type Outcome =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; message: string; incomplete: boolean }
  /** We do not know whether it applied — a lost or late response. Verify, do not retry. */
  | { kind: 'unknown'; message: string }
  | { kind: 'error'; message: string }

export default function TenantLifecyclePanel({
  row,
  onChanged,
  onReport,
}: {
  row: TenantRow
  onChanged: (patch: Partial<TenantRow>) => void
  /**
   * Report the outcome to the PARENT as well as showing it here.
   *
   * Changing a status can remove the row from the current filter — reactivating
   * while filtered to `paused` is the obvious case — and the row unmounts with its
   * message. The partial-restore warning is the single most important thing this
   * screen can say, so it must not depend on the row surviving. The parent renders
   * it above the list where it persists until dismissed.
   */
  onReport: (report: { shopName: string; message: string; incomplete: boolean }) => void
}) {
  const [target, setTarget] = useState<SellerStatus | null>(null)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })

  if (!row.medusaSellerId) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Esta tienda todavía no existe en Medusa (gema sin importar), así que no tiene ciclo de vida
        que administrar.
      </p>
    )
  }

  // Neither non-status state may be acted on — the transition would be decided
  // against an unknown current state — but they need DIFFERENT copy, because one is
  // a retry and the other is a repair job.
  if (row.status === 'absent') {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Medusa no tiene un vendedor para esta tienda, así que no hay ciclo de vida que administrar.
        La fila del espejo quedó huérfana y hay que repararla.
      </p>
    )
  }
  if (row.status === 'unavailable') {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        No pudimos leer el estado de esta tienda, así que no se puede cambiar desde aquí. Vuelve a
        cargar en unos minutos.
      </p>
    )
  }

  const options: SellerStatus[] = row.status === 'active'
    ? ['paused', 'deleted']
    : row.status === 'paused'
      ? ['active', 'deleted']
      // `deleted` is terminal in the backend, so no transition is offered. Saying so
      // beats offering a button that will be refused.
      : []

  async function submit() {
    if (!target || !reason.trim()) return
    setOutcome({ kind: 'working' })
    try {
      const res = await fetch(`/api/admin/tenants/${row.shopId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target, reason: reason.trim() }),
      })
      // The BROWSER transport needs the same three-state discipline as the server
      // client. Both defects below were fixed one round earlier in
      // `lib/admin/tenant-status.ts` and left standing here — guard the population,
      // not the door you found.
      let body: Record<string, unknown> | null = null
      let parseFailed = false
      try {
        body = (await res.json()) as Record<string, unknown> | null
      } catch {
        parseFailed = true
      }

      if (res.ok && (parseFailed || !body || typeof body.complete !== 'boolean')) {
        // A 200 whose body we cannot read is NOT a success we may report. Saying
        // "Listo" and patching the row with the requested target would show the
        // operator their own intent as a confirmed result.
        const message = 'El backend respondió, pero no pudimos leer el resultado. '
          + 'Recarga y verifica el estado de la tienda antes de reintentar.'
        setOutcome({ kind: 'unknown', message })
        onReport({ shopName: row.name, message, incomplete: true })
        return
      }

      if (!res.ok) {
        const unknown = body?.applied === 'unknown'
        setOutcome({
          kind: unknown ? 'unknown' : 'error',
          message: (body?.error as string) ?? `Error ${res.status}`,
        })
        // An unknown outcome is reported UPWARD too: it must survive the row
        // unmounting for the same reason a partial restore must.
        if (unknown) {
          onReport({
            shopName: row.name,
            message: (body?.error as string) ?? 'No sabemos si el cambio se aplicó.',
            incomplete: true,
          })
        }
        return
      }
      // Past the guard above, `body` is present and `complete` is a real boolean.
      const incomplete = body!.complete === false
      const missing: string[] = Array.isArray(body!.missing_products)
        ? (body!.missing_products as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '')
        : []
      const message = incomplete
          ? `Se aplicó el cambio, pero NO se pudo restaurar todo: ${missing.length} producto(s) ya no existen `
            + `(${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}). Revisa antes de darlo por terminado.`
          : target === 'active'
            ? `Reactivada. Se restauraron ${Number(body!.restored ?? 0)} vínculo(s) de catálogo.`
            : `Listo. Se retiraron ${Number(body!.unlinked ?? 0)} vínculo(s) de catálogo.`
      setOutcome({ kind: 'done', incomplete, message })
      // Survives this row leaving the filter.
      onReport({ shopName: row.name, message, incomplete })
      // The SERVER's answer, never the requested target — reporting our own intent
      // back as the result is how a screen lies about what happened.
      onChanged({ status: (body!.to as SellerStatus) ?? target })
      setTarget(null)
      setReason('')
    } catch {
      // The request left the browser and we never heard back. Medusa may well have
      // applied it — the connection dropping is not evidence that it did not — so
      // this is UNKNOWN, not failed. Telling an operator "no se pudo" invites a retry
      // against a shop that is already deleted.
      const message = 'Se perdió la conexión antes de recibir respuesta. NO sabemos si el cambio '
        + 'se aplicó: recarga y verifica el estado de la tienda antes de reintentar.'
      setOutcome({ kind: 'unknown', message })
      onReport({ shopName: row.name, message, incomplete: true })
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs">
        Estado actual: <strong>{sellerStatusLabel(row.status)}</strong>
      </p>

      {options.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">
          Una tienda eliminada no se restaura desde aquí.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              // Disabled while a change is in flight. Leaving these live let an
              // operator start "Pausar", switch to "Eliminar" and submit again with
              // the retained reason — two mutations racing, whose responses could
              // land out of order and leave the screen showing `paused` while Medusa
              // held `deleted`.
              disabled={outcome.kind === 'working'}
              onClick={() => { setTarget(option); setOutcome({ kind: 'idle' }) }}
              className={`rounded border px-2 py-1 text-xs hover:bg-[var(--color-bg)] disabled:opacity-40 ${
                target === option ? 'border-[var(--color-fg)]' : 'border-[var(--color-border)]'
              }`}
            >
              {option === 'active' ? 'Reactivar' : option === 'paused' ? 'Pausar' : 'Eliminar'}
            </button>
          ))}
        </div>
      )}

      {target && (
        <div className="space-y-2 rounded border border-[var(--color-border)] p-2">
          <p className="text-xs">{statusChangeConfirmation(row.name, target)}</p>
          <label className="block text-xs">
            <span className="text-[var(--color-muted)]">Motivo (queda en la auditoría)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Por qué haces este cambio"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              // The reason gates the action, not a validation message after the fact.
              disabled={!reason.trim() || outcome.kind === 'working'}
              className="rounded bg-[var(--color-fg)] px-2 py-1 text-xs text-[var(--color-bg)] disabled:opacity-40"
            >
              {outcome.kind === 'working' ? 'Aplicando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={() => { setTarget(null); setReason('') }}
              // Disabled while the request is in flight. Leaving it live let an
              // operator dismiss the panel while the backend was still unlinking a
              // catalog — hiding a mutation that was very much still happening.
              // Cancelling for real would need an abort the backend honours
              // mid-unlink, which it cannot; so the honest UI is to wait.
              disabled={outcome.kind === 'working'}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {outcome.kind === 'done' && (
        <p className={`text-xs ${outcome.incomplete ? 'text-amber-700' : 'text-[#1d6f42]'}`}>
          {outcome.message}
        </p>
      )}
      {outcome.kind === 'unknown' && (
        <p className="text-xs text-amber-700">{outcome.message}</p>
      )}
      {outcome.kind === 'error' && <p className="text-xs text-red-600">{outcome.message}</p>}
    </div>
  )
}
