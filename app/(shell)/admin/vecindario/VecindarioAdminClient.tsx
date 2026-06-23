'use client'

import { useCallback, useEffect, useState } from 'react'
import { PRINT_SOCIAL_TYPES, type PrintSocialSubmission, type PrintSocialStatus } from '@/lib/print'

/**
 * Vecindario Sánchez moderation — the community-feed curation extracted from the
 * Print admin's "Sección social" tab into its own admin section (S2.2). Manages
 * `print_social_submissions`: the `web_visible` ("Mostrar en línea") opt-in,
 * status, edition assignment, editor-authored items, and delete — over the
 * existing `/api/admin/print/social*` routes (no API change). Approving an item
 * is NOT the same as showing it online; `web_visible` is the separate toggle the
 * public feed reads.
 */

const SOCIAL_STATUSES: PrintSocialStatus[] = ['submitted', 'approved', 'placed', 'rejected']

type EditionOption = { id: string; title?: string }
type SocialRow = PrintSocialSubmission & { print_editions?: { title?: string } | null }

export default function VecindarioAdminClient({ secret }: { secret: string }) {
  const [rows, setRows] = useState<SocialRow[]>([])
  const [editions, setEditions] = useState<EditionOption[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ type: 'reconocimiento', caption: '', body: '', edition_id: '' })

  const api = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/admin/print${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...(init?.headers ?? {}) },
      }),
    [secret],
  )

  const load = useCallback(() => {
    api('/social').then((r) => r.json()).then((d) => setRows(d.submissions ?? []))
    api('/editions').then((r) => r.json()).then((d) => setEditions(d.editions ?? []))
  }, [api])
  useEffect(() => { load() }, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/social/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
    load()
  }
  async function remove(id: string) {
    if (!confirm('¿Borrar este aporte?')) return
    await api(`/social/${id}`, { method: 'DELETE' })
    load()
  }
  async function addEditorItem() {
    if (!form.caption.trim()) return
    await api('/social', { method: 'POST', body: JSON.stringify(form) })
    setForm({ type: 'reconocimiento', caption: '', body: '', edition_id: '' })
    setAdding(false)
    load()
  }

  const typeLabel = (k: string) => PRINT_SOCIAL_TYPES.find((t) => t.key === k)?.label ?? k

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Vecindario Sánchez</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Modera los aportes de la comunidad. Aprobar no es lo mismo que mostrar en línea — usa
          “Mostrar en línea” para publicar en el feed.
        </p>
      </div>

      <button onClick={() => setAdding((v) => !v)} className="text-sm text-[var(--color-accent)]">
        {adding ? '× Cancelar' : '+ Agregar contenido propio'}
      </button>
      {adding && (
        <div className="border border-[var(--color-border)] rounded-xl p-4 space-y-2">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent">
            {PRINT_SOCIAL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <Input placeholder="Descripción corta" value={form.caption} onChange={(v) => setForm({ ...form, caption: v })} />
          <Input placeholder="Texto (opcional)" value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
          <select value={form.edition_id} onChange={(e) => setForm({ ...form, edition_id: e.target.value })}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent">
            <option value="">Sin asignar a edición</option>
            {editions.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <button onClick={addEditorItem} className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold">Agregar</button>
        </div>
      )}

      {rows.length === 0 && <p className="text-sm text-[var(--color-muted)]">Sin aportes todavía.</p>}
      {rows.map((s) => (
        <div key={s.id} className="border border-[var(--color-border)] rounded-xl p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              {s.photos?.[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.photos[0]} alt="" className="h-14 w-14 rounded object-cover border border-[var(--color-border)]" />
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {typeLabel(s.type)}{s.source === 'editor' && ' · editor'}{s.zone && ` · ${s.zone}`}
                </div>
                <div className="font-medium text-sm">{s.caption}</div>
                {s.body && <div className="text-xs text-[var(--color-muted)] mt-0.5">{s.body}</div>}
                <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{s.submitter_name ?? s.submitter_email ?? '—'}</div>
              </div>
            </div>
            <button onClick={() => remove(s.id)} className="text-xs text-red-600">Borrar</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={s.status} onChange={(e) => patch(s.id, { status: e.target.value })}
              className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs bg-transparent">
              {SOCIAL_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
            <select value={s.edition_id ?? ''} onChange={(e) => patch(s.id, { edition_id: e.target.value })}
              className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs bg-transparent">
              <option value="">Sin edición</option>
              {editions.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={s.web_visible === true}
                onChange={(e) => patch(s.id, { web_visible: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              Mostrar en línea
            </label>
          </div>
        </div>
      ))}
    </div>
  )
}

function Input({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
  )
}
