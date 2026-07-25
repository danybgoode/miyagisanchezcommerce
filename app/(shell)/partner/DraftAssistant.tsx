'use client'

import { useState } from 'react'
import { DRAFT_FACT_IDS, type DraftFactId } from '@/lib/portfolio/draft-facts'
import { DRAFT_TEMPLATE_IDS, type DraftTemplateId } from '@/lib/portfolio/draft-compose'
import type { ConfirmChannel } from '@/lib/portfolio/confirm'

/**
 * `app/(shell)/partner/DraftAssistant.tsx`
 *
 * Merchant Partner lifecycle · Sprint 2 (Stories 2.1–2.3) — the per-row draft
 * assistant: pick a template → see the allowed fact list BEFORE generating →
 * generate → edit → save → explicitly confirm a channel → open the browser
 * deep link (or copy the text). Every write goes through the flag-gated,
 * scope-checked routes under `/api/partner/relationship/[id]/draft*`; this
 * component holds no Supabase/Clerk access of its own.
 *
 * README D5 — NO SEND HAPPENS HERE OR ANYWHERE THIS COMPONENT CALLS. The
 * "confirm" step only ever opens an `<a href>` the SERVER handed back (built
 * from the human-approved text) or copies text to the clipboard — the same
 * boundary the server-side routes enforce, expressed client-side.
 *
 * es-MX only. Iconoir icons, never emoji. No Tailwind arbitrary value is
 * built by string interpolation anywhere below.
 */

const FACT_LABEL: Record<DraftFactId, string> = {
  stage: 'Etapa actual',
  stage_label: 'Etapa actual (nombre)',
  age_in_stage_days: 'Días en la etapa',
  next_action_title: 'Título de la próxima acción',
  next_action_due_at: 'Fecha de la próxima acción',
  preferred_channel: 'Canal preferido',
  public_shop_url: 'Liga pública de la tienda',
  preview_url: 'Liga de vista previa',
  partner_display_name: 'Tu nombre como Socio',
  business_name: 'Nombre del negocio',
}

const TEMPLATE_LABEL: Record<DraftTemplateId, string> = {
  follow_up: 'Seguimiento general',
  preview_nudge: 'Invitar a revisar la vista previa',
  activation_reminder: 'Recordatorio de activación',
  retention_checkin: 'Check-in de retención',
}

const CHANNEL_LABEL: Record<ConfirmChannel, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Teléfono',
  email: 'Correo electrónico',
  instagram: 'Instagram',
}

interface DraftState {
  id: string
  templateId: DraftTemplateId
  generatorVersion: number
  factIds: string[]
  draftText: string
  editedText: string | null
  createdBy: string
  createdAt: string
  persisted: boolean
}

interface ConfirmedState {
  confirmedAt: string
  deepLink: string | null
  channel: string
}

export default function DraftAssistant({ relationshipId }: { relationshipId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [templateId, setTemplateId] = useState<DraftTemplateId>('follow_up')
  const [generating, setGenerating] = useState(false)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [knownChannels, setKnownChannels] = useState<ConfirmChannel[]>([])
  const [degraded, setDegraded] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedJustNow, setSavedJustNow] = useState(false)
  const [channel, setChannel] = useState<ConfirmChannel | ''>('')
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedState | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setGenerating(true)
    setError(null)
    setConfirmed(null)
    try {
      const res = await fetch(`/api/partner/relationship/${relationshipId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; draft?: DraftState; knownChannels?: ConfirmChannel[]; degraded?: boolean }
      if (!res.ok || !data.ok || !data.draft) {
        setError(data.error ?? 'No se pudo generar el borrador. Puedes escribir el mensaje a mano.')
        return
      }
      setDraft(data.draft)
      setText(data.draft.editedText ?? data.draft.draftText)
      setKnownChannels(data.knownChannels ?? [])
      setDegraded(Boolean(data.degraded))
      setChannel('')
    } catch {
      setError('Sin conexión. Puedes escribir el mensaje a mano.')
    } finally {
      setGenerating(false)
    }
  }

  async function saveEdit() {
    if (!draft || !draft.persisted) return
    setSaving(true)
    setSavedJustNow(false)
    try {
      const res = await fetch(`/api/partner/relationship/${relationshipId}/draft/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedText: text }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (res.ok && data.ok) setSavedJustNow(true)
      else setError(data.error ?? 'No se pudo guardar la edición.')
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmSend() {
    if (!draft || !draft.persisted || !channel) return
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch(`/api/partner/relationship/${relationshipId}/draft/${draft.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, text }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; confirmedAt?: string; deepLink?: string | null; channel?: string }
      if (!res.ok || !data.ok || !data.confirmedAt) {
        setError(data.error ?? 'No se pudo registrar la confirmación.')
        return
      }
      setConfirmed({ confirmedAt: data.confirmedAt, deepLink: data.deepLink ?? null, channel: data.channel ?? channel })
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setConfirming(false)
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API unavailable — the textarea stays manually selectable.
    }
  }

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="badge badge-neutral" style={{ cursor: 'pointer' }}>
        <i className="iconoir-edit-pencil" aria-hidden /> Redactar seguimiento
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          <i className="iconoir-edit-pencil" aria-hidden /> Borrador de seguimiento
        </span>
        <button type="button" onClick={() => setExpanded(false)} className="text-xs underline">
          Cerrar
        </button>
      </div>

      {!draft && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-muted)]">
            Esto es lo que Miyagi va a usar — nunca datos de contacto ni notas privadas:
          </p>
          <ul className="text-xs text-[var(--color-muted)] grid grid-cols-2 gap-x-3 gap-y-0.5">
            {DRAFT_FACT_IDS.map((factId) => (
              <li key={factId}>· {FACT_LABEL[factId]}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value as DraftTemplateId)} className="input w-auto">
              {DRAFT_TEMPLATE_IDS.map((t) => (
                <option key={t} value={t}>
                  {TEMPLATE_LABEL[t]}
                </option>
              ))}
            </select>
            <button type="button" onClick={generate} disabled={generating} className="btn btn-dark btn-sm">
              {generating ? 'Generando…' : 'Generar borrador'}
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="space-y-2">
          <p className="text-xs text-[color:var(--danger)]">
            <i className="iconoir-warning-triangle" aria-hidden /> Esto es un borrador — Miyagi nunca lo envía
            automáticamente. Revísalo, edítalo si hace falta y confírmalo tú.
          </p>
          {degraded && (
            <p className="text-xs text-[var(--color-muted)]">
              Algunos datos no se pudieron leer; el borrador puede estar incompleto — complétalo a mano.
            </p>
          )}
          {!draft.persisted && (
            <p className="text-xs text-[var(--color-muted)]">
              El borrador no se pudo guardar, pero el texto generado sigue aquí para copiarlo o editarlo a mano.
            </p>
          )}

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSavedJustNow(false)
            }}
            rows={6}
            className="input w-full"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={saveEdit} disabled={saving || !draft.persisted} className="btn btn-secondary btn-sm">
              {saving ? 'Guardando…' : 'Guardar edición'}
            </button>
            {savedJustNow && (
              <span className="text-[var(--color-muted)]">
                <i className="iconoir-check" aria-hidden /> Guardado
              </span>
            )}
            <button type="button" onClick={copyText} className="btn btn-secondary btn-sm">
              <i className="iconoir-copy" aria-hidden /> Copiar texto
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setConfirmed(null)
              }}
              className="underline text-[var(--color-muted)]"
            >
              Generar otro
            </button>
          </div>

          <p className="text-[11px] text-[var(--color-muted)]">
            Generado por: plantilla v{draft.generatorVersion} · {draft.factIds.length} dato(s) usados · creado por{' '}
            {draft.createdBy}
            {draft.createdAt ? ` · ${new Date(draft.createdAt).toLocaleString('es-MX')}` : ''}
          </p>

          {knownChannels.length > 0 && !confirmed && (
            <div className="space-y-1.5 border-t border-[var(--color-border)] pt-2">
              <p className="text-xs">Confirmar y continuar por:</p>
              <div className="flex flex-wrap gap-3">
                {knownChannels.map((c) => (
                  <label key={c} className="text-xs flex items-center gap-1">
                    <input
                      type="radio"
                      name={`confirm-channel-${relationshipId}`}
                      checked={channel === c}
                      onChange={() => setChannel(c)}
                    />
                    {CHANNEL_LABEL[c]}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={confirmSend}
                disabled={!channel || confirming || !draft.persisted}
                className="btn btn-dark btn-sm"
              >
                {confirming ? 'Confirmando…' : 'Confirmar y continuar'}
              </button>
              <p className="text-[11px] text-[var(--color-muted)]">
                Miyagi no envía nada por ti: al confirmar se abre tu app de mensajería/correo (o se prepara el texto
                para copiar) para que TÚ lo envíes.
              </p>
            </div>
          )}

          {confirmed && (
            <div className="space-y-1.5 border-t border-[var(--color-border)] pt-2">
              <p className="text-xs">
                <i className="iconoir-check-circle" aria-hidden /> Confirmado el{' '}
                {new Date(confirmed.confirmedAt).toLocaleString('es-MX')} por ti · canal:{' '}
                {CHANNEL_LABEL[confirmed.channel as ConfirmChannel] ?? confirmed.channel}
              </p>
              {confirmed.deepLink ? (
                <a href={confirmed.deepLink} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm">
                  <i className="iconoir-open-new-window" aria-hidden /> Abrir para enviar
                </a>
              ) : (
                <button type="button" onClick={copyText} className="btn btn-dark btn-sm">
                  <i className="iconoir-copy" aria-hidden /> Copiar texto para enviar
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}
    </div>
  )
}
