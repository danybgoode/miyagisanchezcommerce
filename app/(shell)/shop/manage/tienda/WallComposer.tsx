'use client'

/**
 * Living Shop — the Wall composer (epic 07, Story 1.4).
 *
 * One composer, four kinds. Choosing a kind changes what the form asks for and
 * nothing else — the seller is posting, not configuring a CMS.
 *
 * The object picker only ever lists objects this seller already owns, because
 * that list is rendered from props the SERVER assembled for this shop (see
 * `page.tsx`). There is no shop parameter anywhere in this component, so there is
 * nothing to tamper with — and the route refuses a foreign reference anyway
 * (epic D3), because a picker is a convenience and never a control.
 */

import { useRef, useState } from 'react'
import { WALL_BODY_MAX, WALL_MEDIA_MAX } from '@/lib/wall/validate'
import type { WallEntry, WallKind, WallMedia } from '@/lib/wall/types'
import type { StudioObjects } from './types'

const KINDS: Array<{ key: WallKind; label: string; icon: string; hint: string }> = [
  { key: 'post', label: 'Nota', icon: 'iconoir-post', hint: 'Cuenta algo, con o sin fotos.' },
  { key: 'product', label: 'Producto', icon: 'iconoir-shopping-bag', hint: 'Destaca un artículo de tu catálogo.' },
  { key: 'collection', label: 'Colección', icon: 'iconoir-view-grid', hint: 'Arma una historia alrededor de un grupo.' },
  { key: 'event', label: 'Evento', icon: 'iconoir-calendar', hint: 'Invita a tu gente a algo.' },
]

/**
 * `datetime-local` gives a wall-clock string with no offset. Appending the
 * BROWSER's current offset turns it into the instant the seller actually meant —
 * and the API refuses anything without an explicit offset, so this conversion is
 * the only way the field can be submitted at all. That refusal is deliberate: it
 * makes the ambiguity impossible to reintroduce from a script or an agent.
 */
function toOffsetAware(local: string): string | null {
  if (!local) return null
  const ms = Date.parse(local)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString()
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function WallComposer({
  objects,
  entry,
  onCancel,
  onSaved,
}: {
  objects: StudioObjects
  entry: WallEntry | null
  onCancel: () => void
  onSaved: (entry: WallEntry) => void
}) {
  const editing = !!entry
  const [kind, setKind] = useState<WallKind>(entry?.kind ?? 'post')
  const [body, setBody] = useState(entry?.body ?? '')
  const [media, setMedia] = useState<WallMedia[]>(entry?.media ?? [])
  const [reference, setReference] = useState(entry?.reference_id ?? '')
  const [scheduleLocal, setScheduleLocal] = useState(toLocalInputValue(entry?.scheduled_for ?? null))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/sell/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'No se pudo subir la foto.'); return }
      setMedia((prev) => [...prev, { url: data.url, alt: '' }])
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(intent: 'draft' | 'published' | 'scheduled') {
    setSaving(true)
    setError(null)
    const payload: Record<string, unknown> = {
      kind,
      status: intent,
      body: body.trim() || null,
      media: kind === 'post' ? media : [],
      reference_id: kind === 'post' ? null : reference || null,
    }
    if (intent === 'scheduled') payload.scheduled_for = toOffsetAware(scheduleLocal)

    try {
      const res = await fetch(editing ? `/api/sell/wall/${entry!.id}` : '/api/sell/wall', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'No se pudo guardar.'); return }
      onSaved(data.entry as WallEntry)
    } catch {
      setError('Sin conexión. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const referenceOptions =
    kind === 'product' ? objects.products.map((p) => ({ value: p.id, label: p.title }))
    : kind === 'collection' ? objects.collections.map((c) => ({ value: c.handle, label: c.name }))
    : kind === 'event' ? objects.events.map((e) => ({
        value: e.slug,
        label: `${e.title}${e.cancelled ? ' (cancelado)' : ''}`,
      }))
    : []

  const emptyPoolMessage =
    kind === 'product' ? 'Todavía no tienes productos publicados.'
    : kind === 'collection' ? 'Todavía no tienes colecciones.'
    : kind === 'event' ? 'Todavía no tienes eventos.'
    : null

  return (
    <div className="border border-[var(--border)] rounded-xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold mb-3">{editing ? 'Editar publicación' : 'Nueva publicación'}</h2>

      {/* Kind picker — locked while editing: changing a post into a product would
          invalidate the reference/body pairing the database enforces, so the API
          refuses it and the UI must not offer it. */}
      <fieldset className="mb-4" disabled={editing}>
        <legend className="text-sm font-medium mb-2">¿Qué quieres publicar?</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => { setKind(k.key); setReference(''); }}
              aria-pressed={kind === k.key}
              className={`text-left p-2.5 rounded-lg border text-sm transition-colors ${
                kind === k.key
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:border-[var(--fg-muted)]'
              } ${editing && kind !== k.key ? 'opacity-40' : ''}`}
            >
              <span className="font-medium block"><i className={k.icon} aria-hidden /> {k.label}</span>
              <span className="text-xs text-[var(--fg-muted)]">{k.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {kind !== 'post' && (
        <div className="mb-4">
          <label htmlFor="wall-reference" className="text-sm font-medium block mb-1.5">
            {kind === 'product' ? 'Producto' : kind === 'collection' ? 'Colección' : 'Evento'}
          </label>
          {referenceOptions.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">{emptyPoolMessage}</p>
          ) : (
            <select
              id="wall-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
            >
              <option value="">Elige uno…</option>
              {referenceOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <p className="text-xs text-[var(--fg-muted)] mt-1">
            El precio, la disponibilidad y los datos del evento se leen en vivo. Nunca se copian aquí.
          </p>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="wall-body" className="text-sm font-medium block mb-1.5">
          {kind === 'post' ? 'Tu nota' : 'Nota (opcional)'}
        </label>
        <textarea
          id="wall-body"
          value={body}
          maxLength={WALL_BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={kind === 'post' ? 'Cuéntale algo a quien visita tu tienda…' : 'Por qué lo estás mostrando…'}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        />
        <p className="text-xs text-[var(--fg-muted)] mt-1">{body.length} / {WALL_BODY_MAX}</p>
      </div>

      {kind === 'post' && (
        <div className="mb-4">
          <span className="text-sm font-medium block mb-1.5">Fotos (hasta {WALL_MEDIA_MAX})</span>
          {media.length > 0 && (
            <ul className="space-y-2 mb-2 list-none p-0 m-0">
              {media.map((m, i) => (
                <li key={m.url} className="flex items-start gap-2">
                  {/* Seller uploads are not on the Next Image allow-list. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`alt-${i}`} className="text-xs text-[var(--fg-muted)] block">
                      Describe la foto (para quien no puede verla)
                    </label>
                    <input
                      id={`alt-${i}`}
                      value={m.alt}
                      onChange={(e) => setMedia((prev) => prev.map((x, xi) => xi === i ? { ...x, alt: e.target.value } : x))}
                      placeholder="Ej. Bolsa tejida a mano sobre una mesa de madera"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMedia((prev) => prev.filter((_, xi) => xi !== i))}
                    className="text-xs px-2 py-1 rounded-lg border border-[var(--border)] text-red-600"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {media.length < WALL_MEDIA_MAX && (
            <>
              <input
                ref={fileRef}
                id="wall-media"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }}
              />
              <label
                htmlFor="wall-media"
                className="inline-block text-sm px-3 py-2 rounded-lg border border-[var(--border)] cursor-pointer"
              >
                {uploading ? 'Subiendo…' : 'Agregar foto'}
              </label>
            </>
          )}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="wall-schedule" className="text-sm font-medium block mb-1.5">Programar (opcional)</label>
        <input
          id="wall-schedule"
          type="datetime-local"
          value={scheduleLocal}
          onChange={(e) => setScheduleLocal(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        />
        <p className="text-xs text-[var(--fg-muted)] mt-1">
          Se guarda como un instante exacto en tu zona horaria. Aparece sola cuando llegue la hora.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => submit('draft')}
          className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-sm"
        >
          Guardar borrador
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => submit('published')}
          className="px-3.5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
        >
          Publicar ahora
        </button>
        <button
          type="button"
          disabled={saving || !scheduleLocal}
          title={!scheduleLocal ? 'Elige una fecha para poder programar.' : undefined}
          onClick={() => submit('scheduled')}
          className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-sm disabled:opacity-50"
        >
          Programar
        </button>
        <button type="button" onClick={onCancel} className="px-3.5 py-2 text-sm text-[var(--fg-muted)]">
          Cancelar
        </button>
      </div>
    </div>
  )
}
