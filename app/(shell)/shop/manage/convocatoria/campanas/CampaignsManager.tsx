'use client'

import { useCallback, useEffect, useState } from 'react'
import { SHORTLINK_ORIGIN } from '@/lib/shortlink'

/**
 * Bookshop launchpad · Sprint 3.1 — the campaign builder + list (client).
 * Talks to /api/sell/launchpad/campaigns*. es-MX only.
 */

interface Work { id: string; title: string; thumbnail: string | null }
interface CampaignWork { product_id: string }
interface Campaign {
  id: string
  slug: string
  status: 'draft' | 'active' | 'closed_met' | 'closed_unmet' | 'cancelled'
  title: string | null
  description: string | null
  vote_threshold: number
  ends_at: string | null
  reward_percent: number
  reward_product_id: string | null
  coupon_code: string | null
  works: CampaignWork[]
  vote_count: number
}

const STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: 'Borrador',
  active: 'Activa',
  closed_met: 'Cerrada · umbral alcanzado',
  closed_unmet: 'Cerrada · no se alcanzó',
  cancelled: 'Cancelada',
}

const MISSING_LABEL: Record<string, string> = {
  title: 'el título',
  description: 'la descripción',
  vote_threshold: 'un umbral de votos mayor a cero',
  future_end_date: 'una fecha de cierre futura',
  ends_at: 'la fecha de cierre',
  reward_percent: 'un porcentaje de descuento válido',
  reward_product_id: 'el producto de recompensa',
  reward_not_configurable: 'un producto de impresión configurable como recompensa',
  works: 'al menos una obra candidata',
}

export default function CampaignsManager({ shopSlug }: { shopSlug: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [works, setWorks] = useState<Work[]>([])
  const [rewardCandidates, setRewardCandidates] = useState<Work[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New-campaign form
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [threshold, setThreshold] = useState(3)
  const [rewardPercent, setRewardPercent] = useState(50)
  const [endsAt, setEndsAt] = useState('')
  const [rewardProductId, setRewardProductId] = useState('')
  const [selectedWorks, setSelectedWorks] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, oRes] = await Promise.all([
        fetch('/api/sell/launchpad/campaigns'),
        fetch('/api/sell/launchpad/campaigns/options'),
      ])
      // Surface a real load failure instead of showing an empty state that looks
      // like "no campaigns / no products" when the backend is down or unauthorized.
      if (!cRes.ok || !oRes.ok) {
        setError('No se pudieron cargar tus campañas. Recarga la página o inténtalo más tarde.')
        return
      }
      setError(null)
      setCampaigns(((await cRes.json()).campaigns ?? []) as Campaign[])
      const o = await oRes.json()
      setWorks((o.works ?? []) as Work[])
      setRewardCandidates((o.reward_candidates ?? []) as Work[])
    } catch {
      setError('No se pudieron cargar tus campañas. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleWork = (id: string) =>
    setSelectedWorks((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])

  const create = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/sell/launchpad/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          vote_threshold: threshold,
          reward_percent: rewardPercent,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          reward_product_id: rewardProductId || null,
          work_product_ids: selectedWorks,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'No se pudo crear la campaña.'); return }
      setTitle(''); setDescription(''); setThreshold(3); setRewardPercent(50)
      setEndsAt(''); setRewardProductId(''); setSelectedWorks([])
      await load()
    } finally { setBusy(false) }
  }

  const activate = async (id: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/sell/launchpad/campaigns/${id}/activate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        const missing = (data.missing ?? []) as string[]
        const detail = missing.length ? ` Falta: ${missing.map((m) => MISSING_LABEL[m] ?? m).join(', ')}.` : ''
        setError((data.error ?? 'No se pudo activar.') + detail)
        return
      }
      await load()
    } finally { setBusy(false) }
  }

  const cancel = async (id: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/sell/launchpad/campaigns/${id}/cancel`, { method: 'POST' })
      if (!res.ok) { setError((await res.json()).error ?? 'No se pudo cancelar.'); return }
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return <p style={{ color: 'var(--color-muted)' }}>Cargando…</p>

  return (
    <div>
      {error && (
        <div role="alert" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* New campaign form */}
      <section style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontWeight: 600, fontSize: 16, marginBottom: 12 }}>Nueva campaña</h2>

        <label style={labelStyle}>Título</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vota por el próximo libro" style={inputStyle} />

        <label style={labelStyle}>Descripción</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Explica de qué trata la votación." style={{ ...inputStyle, resize: 'vertical' }} />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <label style={labelStyle}>Umbral de votos</label>
            <input type="number" min={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={inputStyle} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={labelStyle}>Descuento (%)</label>
            <input type="number" min={1} max={100} value={rewardPercent} onChange={(e) => setRewardPercent(Number(e.target.value))} style={inputStyle} />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Fecha de cierre</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <label style={labelStyle}>Producto de recompensa (impresión configurable)</label>
        <select value={rewardProductId} onChange={(e) => setRewardProductId(e.target.value)} style={inputStyle}>
          <option value="">Selecciona un producto…</option>
          {rewardCandidates.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        {rewardCandidates.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: -4, marginBottom: 8 }}>
            No tienes productos de impresión configurables. Crea uno con tamaños/encuadernación o precios por cantidad.
          </p>
        )}

        <label style={labelStyle}>Obras candidatas</label>
        {works.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>Publica obras desde la convocatoria para poder incluirlas.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {works.map((w) => (
              <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={selectedWorks.includes(w.id)} onChange={() => toggleWork(w.id)} />
                {w.title}
              </label>
            ))}
          </div>
        )}

        <button onClick={create} disabled={busy || !title.trim()} style={primaryBtn(busy || !title.trim())}>
          {busy ? 'Guardando…' : 'Crear borrador'}
        </button>
      </section>

      {/* Existing campaigns */}
      <h2 style={{ fontWeight: 600, fontSize: 16, marginBottom: 12 }}>Tus campañas</h2>
      {campaigns.length === 0 ? (
        <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Aún no has creado campañas.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {campaigns.map((c) => (
            <div key={c.id} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{c.title ?? '(sin título)'}</strong>
                <span style={badgeStyle(c.status)}>{STATUS_LABEL[c.status]}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 6 }}>
                {c.vote_count}/{c.vote_threshold} votos · {c.reward_percent}% de descuento · {c.works.length} obra(s)
              </p>
              {c.status === 'active' && (
                <p style={{ fontSize: 13, marginTop: 6 }}>
                  {/* mschz-full-coverage (07, Sprint 1, US-1.3) — the shareable link
                      is the short branded form (mschz.org/v/…); the passthrough
                      (US-1.1) 301s it to the identical /v/<slug> page. */}
                  Página pública: <a href={`${SHORTLINK_ORIGIN}/v/${c.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>mschz.org/v/{c.slug}</a>
                </p>
              )}
              {c.status === 'closed_met' && c.coupon_code && (
                <p style={{ fontSize: 13, marginTop: 6, color: 'var(--color-success)' }}>Cupón desbloqueado: <code>{c.coupon_code}</code></p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {c.status === 'draft' && (
                  <button onClick={() => activate(c.id)} disabled={busy} style={primaryBtn(busy)}>Activar</button>
                )}
                {(c.status === 'draft' || c.status === 'active') && (
                  <button onClick={() => cancel(c.id)} disabled={busy} style={secondaryBtn(busy)}>Cancelar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 24 }}>Tienda: {shopSlug}</p>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }

function primaryBtn(disabled: boolean): React.CSSProperties {
  return { background: disabled ? 'var(--color-muted)' : 'var(--color-accent)', color: 'var(--color-accent-foreground)', border: 'none', padding: '9px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }
}
function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'var(--color-surface)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '9px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }
}
function badgeStyle(status: Campaign['status']): React.CSSProperties {
  const bg = status === 'active' ? 'var(--color-success-soft)' : status === 'closed_met' ? 'var(--color-info-soft)' : status === 'draft' ? 'var(--surface-muted)' : 'var(--color-danger-soft)'
  const fg = status === 'active' ? 'var(--color-success)' : status === 'closed_met' ? 'var(--color-info)' : status === 'draft' ? 'var(--color-foreground)' : 'var(--color-danger)'
  return { background: bg, color: fg, fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }
}
