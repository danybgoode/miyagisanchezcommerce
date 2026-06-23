'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PRINT_TIER_KEYS, PRINT_TIER_DEFAULTS,
  type PrintTier, type PrintTierKey,
  type PrintProvider, type PrintEdition, type PrintAdSubmission,
} from '@/lib/print'
import PrintAdPreview from '@/app/components/PrintAdPreview'

type AdminEdition = PrintEdition & {
  occupancy?: Record<string, number>
  print_providers?: { name?: string } | null
}

function money(cents: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)
}

const EDITION_STATUSES = ['draft', 'open', 'closed', 'in_production', 'distributed'] as const
const SUBMISSION_STATUSES = ['pending_payment', 'paid', 'approved', 'placed', 'rejected', 'refunded'] as const

export default function PrintAdminClient() {
  const [tab, setTab] = useState<'editions' | 'providers'>('editions')

  // Clerk-gated page → same-origin fetches carry the session cookie; no secret.
  const api = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/admin/print${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      }),
    [],
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">Edición impresa — Admin</h1>
      <div className="flex gap-2 mt-4 mb-6">
        {(['editions', 'providers'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-border)]'}`}>
            {t === 'editions' ? 'Ediciones' : 'Proveedores'}
          </button>
        ))}
      </div>
      {tab === 'providers' ? <Providers api={api} />
        : <Editions api={api} />}
    </div>
  )
}

type Api = (path: string, init?: RequestInit) => Promise<Response>

// ── Providers ────────────────────────────────────────────────────────────────

function Providers({ api }: { api: Api }) {
  const [providers, setProviders] = useState<PrintProvider[]>([])
  const [form, setForm] = useState({ slug: '', name: '', location: '', description: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => { api('/providers').then((r) => r.json()).then((d) => setProviders(d.providers ?? [])) }, [api])
  useEffect(() => { load() }, [load])

  async function create() {
    setMsg(null)
    const res = await api('/providers', { method: 'POST', body: JSON.stringify(form) })
    if (!res.ok) { setMsg((await res.json()).error ?? 'Error'); return }
    setForm({ slug: '', name: '', location: '', description: '' })
    load()
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.id} className="border border-[var(--color-border)] rounded-xl p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">{p.name} {p.is_default && <span className="text-xs text-[var(--color-accent)]">· default</span>}</div>
              <div className="text-xs text-[var(--color-muted)]">{p.slug} · {p.location ?? 'sin ubicación'} · {p.active ? 'activo' : 'inactivo'}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-sm">Nuevo proveedor</h3>
        <Input placeholder="slug (ej. miyagiprints)" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
        <Input placeholder="Nombre" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Input placeholder="Ubicación" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
        <Input placeholder="Descripción" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        <button onClick={create} className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold">Crear</button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    </div>
  )
}

// ── Editions ───────────────────────────────────────────────────────────────

function Editions({ api }: { api: Api }) {
  const [editions, setEditions] = useState<AdminEdition[]>([])
  const [providers, setProviders] = useState<PrintProvider[]>([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    api('/editions').then((r) => r.json()).then((d) => setEditions(d.editions ?? []))
    api('/providers').then((r) => r.json()).then((d) => setProviders(d.providers ?? []))
  }, [api])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <button onClick={() => setCreating((v) => !v)} className="text-sm text-[var(--color-accent)]">
        {creating ? '× Cancelar' : '+ Nueva edición'}
      </button>
      {creating && <EditionForm api={api} providers={providers} onDone={() => { setCreating(false); load() }} />}
      {editions.map((e) => <EditionRow key={e.id} api={api} edition={e} onChange={load} />)}
    </div>
  )
}

function EditionForm({ api, providers, onDone }: { api: Api; providers: PrintProvider[]; onDone: () => void }) {
  const [providerId, setProviderId] = useState('')
  const effectiveProviderId = providerId || providers[0]?.id || ''
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState('')
  const [distribution, setDistribution] = useState('')
  const [zones, setZones] = useState('')
  const [tiers, setTiers] = useState<PrintTier[]>(
    PRINT_TIER_KEYS.map((k) => ({ key: k, label: PRINT_TIER_DEFAULTS[k].label, price_cents: 0, capacity: PRINT_TIER_DEFAULTS[k].capacity })),
  )
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setTier(key: PrintTierKey, patch: Partial<PrintTier>) {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  }

  async function submit() {
    setMsg(null); setBusy(true)
    const payload = {
      provider_id: effectiveProviderId,
      title,
      submission_deadline: deadline ? new Date(deadline).toISOString() : null,
      distribution_date: distribution || null,
      coverage_zones: zones.split(',').map((z) => z.trim()).filter(Boolean),
      tiers: tiers.filter((t) => t.price_cents > 0),
    }
    const res = await api('/editions', { method: 'POST', body: JSON.stringify(payload) })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(data?.error ?? 'Error'); return }
    if (data.failed_tiers?.length) setMsg(`Edición creada, pero falló crear productos para: ${data.failed_tiers.join(', ')}`)
    onDone()
  }

  return (
    <div className="border border-[var(--color-border)] rounded-xl p-4 space-y-3">
      <label className="block text-sm">Proveedor
        <select value={effectiveProviderId} onChange={(e) => setProviderId(e.target.value)} className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent">
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <Input placeholder="Título (ej. Edición Mundial 86 — Junio)" value={title} onChange={setTitle} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-[var(--color-muted)]">Cierra (fecha límite)
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </label>
        <label className="block text-xs text-[var(--color-muted)]">Distribución
          <input type="date" value={distribution} onChange={(e) => setDistribution(e.target.value)} className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </label>
      </div>
      <Input placeholder="Zonas de cobertura (separadas por coma)" value={zones} onChange={setZones} />

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1">Tamaños (precio 0 = no se ofrece)</div>
        <div className="space-y-2">
          {tiers.map((t) => (
            <div key={t.key} className="flex items-center gap-2">
              <input value={t.label} onChange={(e) => setTier(t.key, { label: e.target.value })}
                className="flex-1 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm bg-transparent" />
              <input type="number" placeholder="$ MXN" value={t.price_cents ? t.price_cents / 100 : ''}
                onChange={(e) => setTier(t.key, { price_cents: Math.round(Number(e.target.value) * 100) })}
                className="w-24 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm bg-transparent" />
              <input type="number" placeholder="cap" value={t.capacity}
                onChange={(e) => setTier(t.key, { capacity: Number(e.target.value) })}
                className="w-16 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm bg-transparent" />
            </div>
          ))}
        </div>
      </div>

      <button onClick={submit} disabled={busy || !title || !effectiveProviderId}
        className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
        {busy ? 'Creando…' : 'Crear edición + productos'}
      </button>
      {msg && <p className="text-sm text-amber-600">{msg}</p>}
    </div>
  )
}

function EditionRow({ api, edition, onChange }: { api: Api; edition: AdminEdition; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const occ: Record<string, number> = edition.occupancy ?? {}
  const exportHref = `/api/admin/print/editions/${edition.id}/export`

  async function setStatus(status: string) {
    await api(`/editions/${edition.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    onChange()
  }

  return (
    <div className="border border-[var(--color-border)] rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-sm">{edition.title}</div>
          <div className="text-xs text-[var(--color-muted)]">{edition.print_providers?.name}</div>
        </div>
        <select value={edition.status} onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs bg-transparent">
          {EDITION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(edition.tiers ?? []).map((t: PrintTier) => (
          <span key={t.key} className="text-xs px-2 py-0.5 rounded-full border border-[var(--color-border)]" title={t.medusa_product_id ?? 'sin producto'}>
            {t.label} · {money(t.price_cents)} · {(occ[t.key] ?? 0)}/{t.capacity}{!t.medusa_product_id && ' ⚠'}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-[var(--color-accent)]">
          {open ? 'Ocultar anuncios' : 'Ver anuncios'}
        </button>
        <a href={`/admin/print/${edition.id}/builder`}
          className="text-xs text-[var(--color-accent)] no-underline font-medium">
          ✎ Maquetar
        </a>
        <a href={exportHref} className="text-xs text-[var(--color-accent)] no-underline" download>
          ⬇ Descargar paquete de producción
        </a>
      </div>
      {open && <Submissions api={api} editionId={edition.id} tiers={edition.tiers ?? []} />}
    </div>
  )
}

// ── Submissions queue ─────────────────────────────────────────────────────────

function Submissions({ api, editionId, tiers }: { api: Api; editionId: string; tiers: PrintTier[] }) {
  const [subs, setSubs] = useState<PrintAdSubmission[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(() => {
    api(`/editions/${editionId}/submissions`).then((r) => r.json()).then((d) => setSubs(d.submissions ?? []))
  }, [api, editionId])
  useEffect(() => { load() }, [load])

  const tierLabel = (key: string) => tiers.find((t) => t.key === key)?.label ?? key

  async function setStatus(id: string, status: string) {
    await api(`/submissions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    load()
  }

  if (subs.length === 0) return <p className="mt-2 text-xs text-[var(--color-muted)]">Sin anuncios todavía.</p>
  return (
    <div className="mt-3 space-y-2">
      {subs.map((s) => (
        <div key={s.id} className="border border-[var(--color-border)] rounded-lg p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setOpenId((v) => (v === s.id ? null : s.id))} className="font-medium text-left">
              {s.content?.headline || '(sin titular)'} · {tierLabel(s.tier_key)}
            </button>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {(s.status === 'paid' || s.status === 'pending_payment') && (
                <button onClick={() => setStatus(s.id, 'approved')}
                  className="rounded bg-[var(--color-accent)] text-white px-2 py-0.5">Aprobar</button>
              )}
              {s.status !== 'rejected' && s.status !== 'refunded' && (
                <button onClick={() => setStatus(s.id, 'rejected')}
                  className="rounded border border-[var(--color-border)] px-2 py-0.5">Rechazar</button>
              )}
              <select value={s.status} onChange={(e) => setStatus(s.id, e.target.value)}
                className="rounded border border-[var(--color-border)] px-1.5 py-0.5 bg-transparent">
                {SUBMISSION_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
          </div>
          <div className="text-[var(--color-muted)] mt-1">
            {s.buyer_email ?? 'sin email'} · CTA: {s.content?.cta_target?.url ?? '—'}
            {s.content?.photos?.length ? ` · ${s.content.photos.length} fotos` : ''}
          </div>
          {openId === s.id && (
            <div className="mt-3">
              <PrintAdPreview content={s.content ?? {}} tierLabel={tierLabel(s.tier_key)} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Inputs ────────────────────────────────────────────────────────────────────

function Input({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
  )
}

// Vecindario Sánchez ("Sección social") moderation moved to /admin/vecindario in S2.2.
