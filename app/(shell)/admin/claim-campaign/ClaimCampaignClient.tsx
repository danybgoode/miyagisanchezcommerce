'use client'

import { useCallback, useEffect, useState } from 'react'

const CAMPAIGN = 'claim-shop-2026-10'

type Report = { issued: number; claimed: number; removalRequested: number }
type PendingClaim = { shop_id: string; clerk_user_id: string; message: string | null }
type Removal = {
  id: string; shop_id: string; requested_email: string; reason: string;
  state: string; created_at: string; verification_note: string | null
}
type Links = { claimUrl: string; removalUrl: string; expiresAt: string }

const field = 'mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'

async function readJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'No disponible')
  return body
}

export default function ClaimCampaignClient() {
  const [shopSlug, setShopSlug] = useState('')
  const [market, setMarket] = useState<'mx' | 'us'>('mx')
  const [email, setEmail] = useState('')
  const [contactProvenance, setContactProvenance] = useState('')
  const [links, setLinks] = useState<Links | null>(null)
  const [mintError, setMintError] = useState('')
  const [minting, setMinting] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [reportError, setReportError] = useState('')
  const [claims, setClaims] = useState<PendingClaim[] | null>(null)
  const [claimsError, setClaimsError] = useState('')
  const [removals, setRemovals] = useState<Removal[] | null>(null)
  const [removalsError, setRemovalsError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [r, c, x] = await Promise.allSettled([
      readJson(`/api/admin/claim-campaign/report?campaignId=${CAMPAIGN}`),
      readJson('/api/admin/claim-invitations'),
      readJson('/api/admin/removal-requests'),
    ])
    if (r.status === 'fulfilled') { setReport(r.value as Report); setReportError('') }
    else { setReport(null); setReportError(r.reason instanceof Error ? r.reason.message : 'No disponible') }
    if (c.status === 'fulfilled') { setClaims((c.value.requests ?? []) as PendingClaim[]); setClaimsError('') }
    else { setClaims(null); setClaimsError(c.reason instanceof Error ? c.reason.message : 'No disponible') }
    if (x.status === 'fulfilled') { setRemovals((x.value.requests ?? []) as Removal[]); setRemovalsError('') }
    else { setRemovals(null); setRemovalsError(x.reason instanceof Error ? x.reason.message : 'No disponible') }
  }, [])

  useEffect(() => {
    // Schedule the initial network read after mount. The callback updates the
    // three independent remote states; it must not synchronously set them in
    // the effect body.
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  async function mint(event: React.FormEvent) {
    event.preventDefault(); setMintError(''); setLinks(null); setMinting(true)
    try {
      const res = await fetch('/api/admin/claim-invitations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopSlug, market, email, contactProvenance, campaignId: CAMPAIGN }),
      })
      const body = await res.json() as Links & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'No pudimos crear los enlaces.')
      setLinks(body)
      await refresh()
    } catch (error) { setMintError(error instanceof Error ? error.message : 'No pudimos crear los enlaces.') }
    finally { setMinting(false) }
  }

  async function disposition(id: string, action: 'retry_pause' | 'verify' | 'reject' | 'remove') {
    if ((action === 'reject' || action === 'remove') && !window.confirm(action === 'remove'
      ? 'La eliminación es permanente. ¿Confirmas que verificaste la titularidad?'
      : 'La tienda volverá a estar pública. ¿Confirmas que la solicitud fue rechazada?')) return
    setActionBusy(id); setRemovalsError('')
    try {
      const res = await fetch('/api/admin/removal-requests', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, verificationNote: notes[id] ?? '' }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'No pudimos actualizar la solicitud.')
      await refresh()
    } catch (error) { setRemovalsError(error instanceof Error ? error.message : 'No disponible') }
    finally { setActionBusy(null) }
  }

  return <main className="mx-auto max-w-6xl px-4 py-10 text-[var(--color-text)]">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Campaña · {CAMPAIGN}</p>
    <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-border)] pb-7">
      <div><h1 className="text-3xl font-bold tracking-tight">Reclamar una tienda</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">Verifica cada contacto y cada ficha pública. Crea sus dos enlaces, revisa el borrador y envía después desde Resend.</p></div>
      <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold">Borrador · ningún envío desde aquí</span>
    </div>

    <section className="grid gap-3 border-b border-[var(--color-border)] py-7 sm:grid-cols-3" aria-label="Resultados de la campaña">
      {report ? ([['Invitaciones creadas', report.issued], ['Tiendas reclamadas', report.claimed], ['Solicitudes de retiro', report.removalRequested]] as const).map(([label, value]) =>
        <div key={label} className="border-l-2 border-[var(--color-accent)] pl-4"><p className="font-mono text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-[var(--color-muted)]">{label}</p></div>)
        : <p className="text-sm text-[var(--color-muted)] sm:col-span-3">Métricas no disponibles: {reportError || 'Cargando…'}</p>}
    </section>

    <div className="grid gap-10 py-9 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section>
        <h2 className="text-xl font-semibold">Crear los enlaces de una tienda</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">La tienda debe estar pública, activa y sin reclamar. Guarda la procedencia del correo antes de crear la invitación.</p>
        <form onSubmit={mint} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Identificador de la tienda<input required value={shopSlug} onChange={e => setShopSlug(e.target.value)} className={field} placeholder="mi-tienda" /></label>
          <label className="text-sm font-medium">Mercado<select value={market} onChange={e => setMarket(e.target.value as 'mx' | 'us')} className={field}><option value="mx">México</option><option value="us">Estados Unidos</option></select></label>
          <label className="text-sm font-medium sm:col-span-2">Correo del contacto<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className={field} /></label>
          <label className="text-sm font-medium sm:col-span-2">Dónde verificaste el correo<input required value={contactProvenance} onChange={e => setContactProvenance(e.target.value)} className={field} placeholder="Sitio oficial de la tienda, página de contacto" /></label>
          {mintError && <p className="text-sm text-red-700 sm:col-span-2" role="alert">{mintError}</p>}
          <button disabled={minting} className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{minting ? 'Verificando…' : 'Crear enlaces para el borrador'}</button>
        </form>
        {links && <div className="mt-6 space-y-4 rounded-md border border-[var(--color-border)] p-5" role="status">
          <p className="text-sm font-semibold">Enlaces listos · vencen el {new Date(links.expiresAt).toLocaleDateString('es-MX')}</p>
          {([['Reclamar', links.claimUrl], ['Solicitar retiro', links.removalUrl]] as const).map(([label, value]) => <div key={label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
            <div className="mt-1 flex gap-2"><input readOnly aria-label={`Enlace para ${label.toLowerCase()}`} value={value} className={`${field} mt-0 min-w-0 font-mono text-xs`} /><button type="button" onClick={() => void navigator.clipboard.writeText(value)} className="rounded border border-[var(--color-border)] px-3 text-xs font-semibold">Copiar</button></div>
          </div>)}
          <p className="text-xs text-[var(--color-muted)]">Pega cada enlace solo en el borrador de este destinatario. Este panel no envía mensajes.</p>
        </div>}
      </section>

      <section>
        <h2 className="text-xl font-semibold">Solicitudes por revisar</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">Los formularios públicos piden revisión humana; no transfieren la tienda.</p>
        <div className="mt-5 space-y-3">
          {claims === null ? <p className="text-sm text-red-700">No disponibles: {claimsError || 'Cargando…'}</p>
            : claims.length === 0 ? <p className="text-sm text-[var(--color-muted)]">No hay solicitudes de acceso pendientes.</p>
              : claims.map((claim, index) => <div key={`${claim.shop_id}-${claim.clerk_user_id}-${index}`} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                <p className="font-mono text-xs">{claim.shop_id}</p><p className="mt-1">{claim.clerk_user_id.replace(/^pending:/, '')}</p>{claim.message && <p className="mt-2 text-[var(--color-muted)]">{claim.message}</p>}
              </div>)}
        </div>
      </section>
    </div>

    <section className="border-t border-[var(--color-border)] pt-8">
      <h2 className="text-xl font-semibold">Solicitudes de retiro</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">Una ficha pausada queda fuera de línea. Verifica a la persona antes de retirarla definitivamente; si rechazas la solicitud, la tienda se restaura.</p>
      {removalsError && <p className="mt-3 text-sm text-red-700" role="alert">{removalsError}</p>}
      {removals === null ? <p className="mt-5 text-sm text-[var(--color-muted)]">Solicitudes no disponibles.</p>
        : removals.length === 0 ? <p className="mt-5 text-sm text-[var(--color-muted)]">No hay solicitudes de retiro.</p>
          : <div className="mt-5 grid gap-3 lg:grid-cols-2">{removals.map((request) => <article key={request.id} className="rounded-md border border-[var(--color-border)] p-4">
            <div className="flex items-start justify-between gap-3"><p className="font-mono text-xs">{request.id}</p><span className="rounded bg-[var(--color-background)] px-2 py-1 text-xs font-semibold">{request.state}</span></div>
            <p className="mt-2 text-sm font-semibold">{request.requested_email}</p><p className="mt-1 font-mono text-xs text-[var(--color-muted)]">{request.shop_id}</p>
            <p className="mt-3 text-sm">{request.reason}</p>
            {request.state === 'paused' && <textarea aria-label={`Cómo verificaste ${request.id}`} value={notes[request.id] ?? ''} onChange={e => setNotes({ ...notes, [request.id]: e.target.value })} placeholder="Cómo verificaste a esta persona" className={`${field} mt-4`} rows={2} />}
            <div className="mt-3 flex flex-wrap gap-2">
              {(request.state === 'received' || request.state === 'status_unknown') && <button disabled={actionBusy === request.id} onClick={() => void disposition(request.id, 'retry_pause')} className="rounded border px-3 py-2 text-xs font-semibold">Confirmar pausa</button>}
              {request.state === 'paused' && <><button disabled={actionBusy === request.id} onClick={() => void disposition(request.id, 'verify')} className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-white">Registrar verificación</button><button disabled={actionBusy === request.id} onClick={() => void disposition(request.id, 'reject')} className="rounded border px-3 py-2 text-xs font-semibold">Rechazar y restaurar</button></>}
              {request.state === 'verified' && <button disabled={actionBusy === request.id} onClick={() => void disposition(request.id, 'remove')} className="rounded border border-red-700 px-3 py-2 text-xs font-semibold text-red-700">Retirar definitivamente</button>}
            </div>
          </article>)}</div>}
    </section>
  </main>
}
