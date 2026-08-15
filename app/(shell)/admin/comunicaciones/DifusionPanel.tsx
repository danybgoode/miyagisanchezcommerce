'use client'

import { useState } from 'react'
import {
  BROADCAST_CONFIRM_PHRASE,
  BROADCAST_LIMITS,
  type BroadcastAudience,
} from '@/lib/notifications/broadcast'

/**
 * Difusión — one operational message to every seller or every buyer.
 *
 * The screen enforces the same two-step the server does, for the same reason: this
 * is the only place in the product that mails everyone at once, and an operator
 * should never be one click from that. Preview first, and the send button does not
 * exist until a preview has returned a recipient list they can read.
 *
 * The server is the control, not this component. It re-validates the draft,
 * re-resolves the list, and refuses if the count moved since the preview.
 */
type Preview = {
  count: number
  max: number
  recipients: { email: string; label: string }[]
  skipped: { label: string; reason: string }[]
  preview: { subject: string; headline: string; paragraphs: string[]; ctaLabel: string | null; ctaUrl: string | null }
}

type Result = { sent: number; failed: number; complete: boolean; failures: { email: string; error?: string }[] }

const AUDIENCE_LABEL: Record<BroadcastAudience, string> = {
  sellers: 'Vendedores (tiendas con cuenta)',
  buyers: 'Compradores (con al menos un pedido)',
}

export default function DifusionPanel() {
  const [audience, setAudience] = useState<BroadcastAudience>('sellers')
  const [subject, setSubject] = useState('')
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [confirm, setConfirm] = useState('')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = {
    audience,
    subject,
    headline,
    body,
    ctaLabel: ctaLabel.trim() || null,
    ctaUrl: ctaUrl.trim() || null,
  }

  // Any edit invalidates the approved list — the operator must look again.
  function edited<T>(setter: (v: T) => void) {
    return (value: T) => {
      setPreview(null)
      setResult(null)
      setError(null)
      setConfirm('')
      setter(value)
    }
  }

  async function post(mode: 'preview' | 'send') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/comunicaciones/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'preview'
            ? draft
            : { ...draft, mode: 'send', confirm, expectedCount: preview?.count },
        ),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Error ${res.status}`)
        // A refused send means the list moved — drop the stale approval.
        if (mode === 'send') setPreview(null)
        return
      }
      if (mode === 'preview') setPreview(data as Preview)
      else {
        setResult(data as Result)
        setPreview(null)
        setConfirm('')
      }
    } catch {
      setError('No se pudo contactar al servidor.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border rounded-lg p-4 space-y-4" style={{ borderColor: 'var(--border)' }}>
      <div>
        <h2 className="text-lg font-bold">Difusión</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Un aviso operativo del equipo a todos los vendedores o a todos los compradores. Se envía
          por correo, con el mismo diseño que el resto de los mensajes de la plataforma. Úsalo para
          caídas, cambios importantes y avisos que no pueden esperar a que alguien visite el sitio.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Público</span>
          <select
            value={audience}
            onChange={(e) => edited(setAudience)(e.target.value as BroadcastAudience)}
            className="border rounded px-2 py-1"
          >
            {(Object.keys(AUDIENCE_LABEL) as BroadcastAudience[]).map((key) => (
              <option key={key} value={key}>{AUDIENCE_LABEL[key]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">
            Asunto ({subject.length}/{BROADCAST_LIMITS.subject.max})
          </span>
          <input
            value={subject}
            onChange={(e) => edited(setSubject)(e.target.value)}
            maxLength={BROADCAST_LIMITS.subject.max}
            className="border rounded px-2 py-1"
            placeholder="Ya quedó resuelto: los correos de pedidos"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-[var(--color-muted)]">
          Título dentro del correo ({headline.length}/{BROADCAST_LIMITS.headline.max})
        </span>
        <input
          value={headline}
          onChange={(e) => edited(setHeadline)(e.target.value)}
          maxLength={BROADCAST_LIMITS.headline.max}
          className="border rounded px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-[var(--color-muted)]">
          Mensaje ({body.length}/{BROADCAST_LIMITS.body.max}) · una línea en blanco separa párrafos ·
          texto simple, sin HTML
        </span>
        <textarea
          value={body}
          onChange={(e) => edited(setBody)(e.target.value)}
          maxLength={BROADCAST_LIMITS.body.max}
          rows={8}
          className="border rounded px-2 py-1 font-mono text-xs"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Botón (opcional)</span>
          <input
            value={ctaLabel}
            onChange={(e) => edited(setCtaLabel)(e.target.value)}
            maxLength={BROADCAST_LIMITS.ctaLabel.max}
            className="border rounded px-2 py-1"
            placeholder="Ver mis pedidos"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted)]">Enlace del botón (https://)</span>
          <input
            value={ctaUrl}
            onChange={(e) => edited(setCtaUrl)(e.target.value)}
            className="border rounded px-2 py-1"
            placeholder="https://miyagisanchez.com/shop/manage/orders"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => post('preview')}
          disabled={busy}
          className="btn btn-secondary"
        >
          {busy && !preview ? 'Revisando…' : 'Ver a quién le llega'}
        </button>
        {preview && (
          <span className="text-sm">
            <strong>{preview.count}</strong> destinatario{preview.count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--danger, #b42318)' }}>{error}</p>
      )}

      {preview && (
        <div className="space-y-3 text-sm border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="font-semibold mb-1">Le llega a:</p>
            <ul className="text-xs text-[var(--color-muted)] max-h-40 overflow-auto">
              {preview.recipients.map((r) => (
                <li key={r.email}>{r.email} <span className="opacity-60">— {r.label}</span></li>
              ))}
            </ul>
          </div>

          {preview.skipped.length > 0 && (
            /* Named, not hidden: an operator deciding "everyone was told" needs to
               know who could not be reached, and why. */
            <div>
              <p className="font-semibold mb-1">No se puede alcanzar ({preview.skipped.length}):</p>
              <ul className="text-xs text-[var(--color-muted)] max-h-32 overflow-auto">
                {preview.skipped.map((s, i) => (
                  <li key={i}>{s.label} — {s.reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="border rounded p-3 bg-[var(--bg-sunk)]" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs text-[var(--color-muted)] mb-2">Vista previa</p>
            <p className="text-xs mb-2"><strong>Asunto:</strong> {preview.preview.subject}</p>
            <p className="font-bold mb-2">{preview.preview.headline}</p>
            {preview.preview.paragraphs.map((text, i) => <p key={i} className="mb-2">{text}</p>)}
            {preview.preview.ctaLabel && (
              <p className="text-xs opacity-70">[ {preview.preview.ctaLabel} → {preview.preview.ctaUrl} ]</p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-muted)]">
                Escribe {BROADCAST_CONFIRM_PHRASE} para confirmar
              </span>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="border rounded px-2 py-1 w-40"
              />
            </label>
            <button
              type="button"
              onClick={() => post('send')}
              disabled={busy || confirm !== BROADCAST_CONFIRM_PHRASE}
              className="btn btn-primary"
            >
              {busy ? 'Enviando…' : `Enviar a ${preview.count}`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="text-sm border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p>
            <strong>{result.sent}</strong> enviado{result.sent === 1 ? '' : 's'}
            {result.failed > 0 && <> · <strong>{result.failed}</strong> fallaron</>}
          </p>
          {/* A partial send says partial. "Listo" over 12 of 14 is a report that does
              not match what happened. */}
          {!result.complete && (
            <ul className="text-xs mt-1" style={{ color: 'var(--danger, #b42318)' }}>
              {result.failures.map((f) => <li key={f.email}>{f.email} — {f.error ?? 'error'}</li>)}
            </ul>
          )}
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Cada envío quedó registrado en <code>notification_log</code>.
          </p>
        </div>
      )}
    </section>
  )
}
