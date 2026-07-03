'use client'

import { useState } from 'react'
import { CATEGORIES } from '@/lib/types'

type Shop = { shopId: string; slug: string; name: string }

/**
 * Promoter Funnel v2 · Sprint 5 (US-5.1) — add a real, published listing (title,
 * price, category, photos) to the merchant's shop during the close, so it looks
 * real at /s/[slug] and in search from the moment the promoter walks out.
 * Thin screen over POST /api/promoter/close/listing.
 */
export default function ListingStep({ shop, n }: { shop: Shop; n: number }) {
  const [title, setTitle] = useState('')
  const [priceMxn, setPriceMxn] = useState('')
  const [category, setCategory] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

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
      for (const file of Array.from(files).slice(0, 6)) {
        const url = await uploadPhoto(file)
        if (url) uploaded.push(url)
      }
      setPhotos((prev) => [...prev, ...uploaded].slice(0, 6))
    } finally {
      setUploading(false)
    }
  }

  async function addListing() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/promoter/close/listing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: shop.shopId,
          title,
          category,
          price_mxn: priceMxn ? Number(priceMxn) : undefined,
          images: photos.map((url) => ({ url })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo crear el anuncio.'); return }
      setDone(true)
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <h2 className="font-semibold">
        <span className="text-[var(--color-muted)] mr-2">{n}.</span>Agregar un anuncio
      </h2>
      {done ? (
        <p className="text-sm text-[color:var(--success)]">
          ✅ Anuncio publicado — ya se ve en <a className="underline" href={`/s/${shop.slug}`} target="_blank" rel="noreferrer">/s/{shop.slug}</a>.
        </p>
      ) : (
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título del anuncio"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
          <div className="flex gap-2">
            <input value={priceMxn} onChange={(e) => setPriceMxn(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Precio (MXN, opcional)" inputMode="decimal"
              className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría"
              className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2">
              <option value="">Categoría…</option>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-muted)]">
              Fotos ({photos.length}/6)
              <input type="file" accept="image/*" multiple disabled={uploading || photos.length >= 6}
                onChange={(e) => onPhotos(e.target.files)}
                className="mt-1 block w-full text-sm" />
            </label>
            {photos.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote R2/Supabase URLs, no next/image domain config here */}
                {photos.map((url) => <img key={url} src={url} alt="" className="h-16 w-16 rounded object-cover" />)}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
          <button onClick={addListing} disabled={busy || uploading || title.trim().length < 3 || !category}
            className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
            {busy ? 'Publicando…' : 'Publicar anuncio'}
          </button>
        </div>
      )}
    </section>
  )
}
