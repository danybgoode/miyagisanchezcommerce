'use client'

import { useEffect, useState } from 'react'
import type { PrintEditionPublic, PrintAdContent } from '@/lib/print'
import { matchesCoverage, COVERAGE_NOTICE_TEXT } from '@/lib/promoter-coverage'

type Shop = { shopId: string; slug: string; name: string; estado?: string | null; municipio?: string | null }
type Mode = 'now' | 'later'
type Provider = 'stripe' | 'mercadopago' | 'cash' | 'spei' | 'manual'

function formatMXN(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)
}

/**
 * Promoter Funnel v2 · Sprint 5 (US-5.4 + US-5.3) — sell + design a printed ad
 * right in the close flow, reusing the existing self-serve ad content shape
 * and the already-existing POST /api/promoter/close/print route (unchanged —
 * it already accepts `content: PrintAdContent`). Shows US-5.3's coverage
 * honesty notice before the sale when the shop is outside the edition's
 * `coverage_zones` — informative only, never blocks the sale.
 */
export default function PrintAdStep({ shop, n }: { shop: Shop; n: number }) {
  const [editions, setEditions] = useState<PrintEditionPublic[] | null>(null)
  const [editionId, setEditionId] = useState('')
  const [tierKey, setTierKey] = useState('')
  const [mode, setMode] = useState<Mode>('now')
  const [provider, setProvider] = useState<Provider>('cash')
  const [headline, setHeadline] = useState('')
  const [subhead, setSubhead] = useState('')
  const [body, setBody] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/print/editions?status=open')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const list: PrintEditionPublic[] = data.editions ?? []
        setEditions(list)
        if (list[0]) {
          setEditionId(list[0].id)
          setTierKey(list[0].tiers.find((t) => !t.sold_out)?.key ?? '')
        }
      })
      .catch(() => { if (!cancelled) setEditions([]) })
    return () => { cancelled = true }
  }, [])

  const edition = editions?.find((e) => e.id === editionId) ?? null
  const tier = edition?.tiers.find((t) => t.key === tierKey) ?? null

  const coverage = edition
    ? matchesCoverage({ estado: shop.estado, municipio: shop.municipio }, edition.coverage_zones)
    : null

  async function uploadPhoto(file: File): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/sell/upload', { method: 'POST', body: fd })
    if (!res.ok) return null
    const { url } = await res.json()
    return url ?? null
  }

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setError(null)
    try {
      const uploaded: string[] = []
      let failed = 0
      for (const file of Array.from(files).slice(0, 4)) {
        const url = await uploadPhoto(file)
        if (url) uploaded.push(url); else failed++
      }
      setPhotos((prev) => [...prev, ...uploaded].slice(0, 4))
      if (failed > 0) {
        setError(failed === 1 ? 'Una foto no se pudo subir. Intenta de nuevo.' : `${failed} fotos no se pudieron subir. Intenta de nuevo.`)
      }
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!edition || !tier) return
    setBusy(true); setError(null)
    try {
      const content: PrintAdContent = mode === 'now'
        ? {
            headline: headline.trim(),
            subhead: subhead.trim(),
            body: body.trim(),
            photos,
            contact: { whatsapp_seller: whatsapp.trim() || null },
            cta_target: { type: 'shop', id: shop.slug, url: `/s/${shop.slug}` },
          }
        : {}

      const res = await fetch('/api/promoter/close/print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shop.shopId, editionId: edition.id, tierKey: tier.key, provider, content }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo iniciar el pago.'); return }
      if (data.url) { window.location.href = data.url; return }
      setDone(true)
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  if (editions !== null && editions.length === 0) return null // no open edition to sell

  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <h2 className="font-semibold">
        <span className="text-[var(--color-muted)] mr-2">{n}.</span>Anuncio impreso (opcional)
      </h2>
      {!editions ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando ediciones…</p>
      ) : done ? (
        <p className="text-sm text-[color:var(--success)]"><i className="iconoir-check-circle" aria-hidden /> Anuncio registrado en la cola editorial.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select value={editionId} onChange={(e) => { setEditionId(e.target.value); setTierKey('') }}
              aria-label="Edición" className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              {editions.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
            <select value={tierKey} onChange={(e) => setTierKey(e.target.value)}
              aria-label="Tamaño" className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              {edition?.tiers.map((t) => (
                <option key={t.key} value={t.key} disabled={t.sold_out}>
                  {t.label} — {formatMXN(t.price_cents)}{t.sold_out ? ' (agotado)' : ''}
                </option>
              ))}
            </select>
          </div>

          {coverage && !coverage.inCoverage && (
            <p className="text-sm rounded-lg bg-[var(--color-surface)] p-3 text-[var(--color-muted)]">
              ℹ️ {COVERAGE_NOTICE_TEXT}
            </p>
          )}

          <div className="flex gap-2" role="radiogroup" aria-label="Diseño del anuncio">
            <button type="button" onClick={() => setMode('now')} disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'now' ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--fg-inverse)]' : 'border-[var(--color-border)]'}`}>
              Diseñar ahora
            </button>
            <button type="button" onClick={() => setMode('later')} disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'later' ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--fg-inverse)]' : 'border-[var(--color-border)]'}`}>
              El comerciante lo diseña después
            </button>
          </div>

          {mode === 'now' && (
            <div className="space-y-2">
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Título"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
              <input value={subhead} onChange={(e) => setSubhead(e.target.value)} placeholder="Subtítulo (opcional)"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Descripción"
                rows={3} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp de contacto (opcional)"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
              <label className="block text-sm text-[var(--color-muted)]">
                Fotos ({photos.length}/4)
                <input type="file" accept="image/*" multiple disabled={uploading || photos.length >= 4}
                  onChange={(e) => onPhotos(e.target.files)} className="mt-1 block w-full text-sm" />
              </label>
            </div>
          )}

          <label className="block text-sm">
            <span className="text-[var(--color-muted)]">Cómo cobras</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} disabled={busy}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2">
              <option value="cash">Efectivo (reportado)</option>
              <option value="spei">SPEI</option>
              <option value="manual">Otro manual</option>
              <option value="stripe">Tarjeta (Stripe)</option>
              <option value="mercadopago">MercadoPago</option>
            </select>
          </label>

          {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
          <button onClick={submit} disabled={busy || uploading || !tier}
            className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
            {busy ? 'Procesando…' : 'Cerrar anuncio impreso'}
          </button>
        </div>
      )}
    </section>
  )
}
