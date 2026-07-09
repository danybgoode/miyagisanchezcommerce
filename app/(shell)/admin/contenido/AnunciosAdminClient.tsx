'use client'

import { useMemo, useState } from 'react'
import { resolveAnnouncementStatus, type AnnouncementStatus } from '@/lib/announcements-merge'

/** One `platform_announcements` row, as rendered on the admin surface. */
export type AnnouncementView = {
  id: string
  audience: 'seller' | 'buyer'
  text: string
  ctaLabel: string | null
  ctaLink: string | null
  startsAt: string | null
  endsAt: string | null
  active: boolean
  updatedAt: string | null
}

type Status = AnnouncementStatus

const STATUS_LABEL: Record<Status, string> = {
  programado: 'Programado',
  activo: 'Activo',
  expirado: 'Expirado',
  inactivo: 'Inactivo',
}

const STATUS_COLOR: Record<Status, string> = {
  programado: 'var(--warn, #b8860b)',
  activo: 'var(--accent)',
  expirado: 'var(--fg-subtle)',
  inactivo: 'var(--fg-muted)',
}

const AUDIENCE_LABEL: Record<'seller' | 'buyer', string> = {
  seller: 'Vendedores',
  buyer: 'Compradores',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  background: 'var(--bg)',
  color: 'var(--fg)',
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// `<input type="datetime-local">` yields a naive string with NO timezone info. `new
// Date(naive)` parses it in the BROWSER's local timezone (correct — the admin's real
// clock), so converting to a real ISO string here, client-side, is what makes the
// round-trip correct. Sending the naive string as-is would let the SERVER's
// `Date.parse` reinterpret it in the server's own timezone (UTC on Vercel) — hours off
// from what a Mexico-based admin actually picked.
function toIsoOrNull(datetimeLocal: string): string | null {
  if (!datetimeLocal) return null
  const ms = new Date(datetimeLocal).getTime()
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

type FormState = {
  id: string | null
  audience: 'seller' | 'buyer'
  text: string
  ctaLabel: string
  ctaLink: string
  startsAt: string
  endsAt: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  audience: 'seller',
  text: '',
  ctaLabel: '',
  ctaLink: '',
  startsAt: '',
  endsAt: '',
  active: true,
}

/**
 * `/admin/contenido` — announcement CRUD panel (epic 08 ·
 * admin-content-and-announcements, Sprint 3). Clerk-gated — the same-origin fetch
 * carries the session cookie. Creating/editing with `active` true while another
 * campaign is already active for that audience surfaces a `409` conflict inline with
 * a "Reemplazar" action, which resubmits with `replaceExisting: true`.
 */
export default function AnunciosAdminClient({ announcements }: { announcements: AnnouncementView[] }) {
  const [rows, setRows] = useState<AnnouncementView[]>(announcements)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<AnnouncementView | null>(null)

  const now = Date.now()
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '') * -1),
    [rows],
  )

  function openCreate() {
    setForm(EMPTY_FORM)
    setConflict(null)
    setError(null)
  }

  function openEdit(a: AnnouncementView) {
    setForm({
      id: a.id,
      audience: a.audience,
      text: a.text,
      ctaLabel: a.ctaLabel ?? '',
      ctaLink: a.ctaLink ?? '',
      startsAt: toDatetimeLocal(a.startsAt),
      endsAt: toDatetimeLocal(a.endsAt),
      active: a.active,
    })
    setConflict(null)
    setError(null)
  }

  async function submit(replaceExisting: boolean) {
    if (!form) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          audience: form.audience,
          text: form.text,
          ctaLabel: form.ctaLabel || null,
          ctaLink: form.ctaLink || null,
          startsAt: toIsoOrNull(form.startsAt),
          endsAt: toIsoOrNull(form.endsAt),
          active: form.active,
          replaceExisting,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setConflict(data?.conflict ?? null)
        return
      }
      if (!res.ok) {
        setError(data?.error ?? 'No se pudo guardar.')
        return
      }
      const saved = data.announcement
      setRows((prev) => {
        const withoutId = prev.filter((r) => r.id !== saved.id)
        const next: AnnouncementView = {
          id: saved.id,
          audience: saved.audience,
          text: saved.text,
          ctaLabel: saved.cta_label ?? null,
          ctaLink: saved.cta_link ?? null,
          startsAt: saved.starts_at ?? null,
          endsAt: saved.ends_at ?? null,
          active: saved.active,
          updatedAt: saved.updated_at ?? null,
        }
        // A replace-swap also deactivates a sibling row server-side — reflect that
        // locally too so the list doesn't show two "active" badges until a refresh.
        const reconciled = withoutId.map((r) =>
          r.audience === saved.audience && r.active && replaceExisting ? { ...r, active: false } : r,
        )
        return [...reconciled, next]
      })
      setForm(null)
      setConflict(null)
    } catch {
      setError('Error de red al guardar.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'No se pudo eliminar.')
        return
      }
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch {
      setError('Error de red al eliminar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: 'var(--fg)' }}>Anuncios</h2>
      <p style={{ color: 'var(--fg-muted)', fontSize: 14, margin: '0 0 16px' }}>
        Campañas programadas para vendedores (franja en /shop/manage) o compradores (tarjeta en el inicio).
        Una sola campaña activa por audiencia.
      </p>

      {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '0 0 16px' }}>{error}</p>}

      {!form && (
        <button onClick={openCreate} style={{ ...buttonStyle, marginBottom: 16 }}>
          + Nueva campaña
        </button>
      )}

      {form && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value as 'seller' | 'buyer' })}
              style={{ ...inputStyle, flex: 'none', width: 160 }}
            >
              <option value="seller">Vendedores</option>
              <option value="buyer">Compradores</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg)' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Activa
            </label>
          </div>
          <textarea
            rows={2}
            placeholder="Texto del anuncio"
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Etiqueta del CTA (opcional)"
              value={form.ctaLabel}
              onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Link del CTA (https://…, opcional)"
              value={form.ctaLink}
              onChange={(e) => setForm({ ...form, ctaLink: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--fg-muted)', flex: 1 }}>
              Inicio (opcional)
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--fg-muted)', flex: 1 }}>
              Fin (opcional)
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                style={inputStyle}
              />
            </label>
          </div>

          {conflict && (
            <div style={{ background: 'var(--bg-sunk)', borderRadius: 6, padding: 10, fontSize: 13, color: 'var(--fg)' }}>
              Ya hay una campaña activa para {AUDIENCE_LABEL[conflict.audience]}: «{conflict.text}».
              <button onClick={() => submit(true)} disabled={busy} style={{ ...buttonStyle, marginLeft: 10 }}>
                Reemplazar
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => submit(false)} disabled={busy} style={buttonStyle}>
              {busy ? '…' : 'Guardar'}
            </button>
            <button onClick={() => { setForm(null); setConflict(null); setError(null) }} style={buttonStyle}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {sorted.map((a) => {
        const status = resolveAnnouncementStatus(a, now)
        return (
          <div key={a.id} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span
              style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[status], textTransform: 'uppercase', width: 70, flexShrink: 0, marginTop: 2 }}
            >
              {STATUS_LABEL[status]}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{AUDIENCE_LABEL[a.audience]}</div>
              <div style={{ fontSize: 14, color: 'var(--fg)' }}>{a.text}</div>
              {a.ctaLabel && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>CTA: {a.ctaLabel} → {a.ctaLink}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => openEdit(a)} style={buttonStyle}>Editar</button>
              <button onClick={() => remove(a.id)} disabled={busy} style={buttonStyle}>Eliminar</button>
            </div>
          </div>
        )
      })}
      {sorted.length === 0 && <p style={{ color: 'var(--fg-muted)', fontSize: 14 }}>Ningún anuncio todavía.</p>}
    </div>
  )
}
