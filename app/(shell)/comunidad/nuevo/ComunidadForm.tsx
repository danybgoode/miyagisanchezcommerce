'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { PRINT_SOCIAL_TYPES, type PrintSocialType } from '@/lib/print'
import { NEIGHBORHOOD_PULSE_COPY } from '@/lib/neighborhood-pulse'

export default function ComunidadForm() {
  const [type, setType] = useState<PrintSocialType>('saludo')
  const [caption, setCaption] = useState('')
  const [body, setBody] = useState('')
  const [zone, setZone] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return
    const out: string[] = []
    for (const file of Array.from(files).slice(0, 4)) {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/sell/upload', { method: 'POST', body: fd })
      if (res.ok) { const { url } = await res.json(); if (url) out.push(url) }
    }
    setPhotos((p) => [...p, ...out].slice(0, 4))
  }

  async function submit() {
    setError(null)
    if (caption.trim().length < 3) { setError('Escribe una descripción breve.'); return }
    setBusy(true)
    const res = await fetch('/api/print/social', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, caption, body, zone, photos }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({})))?.error ?? 'No se pudo enviar.'); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="text-4xl mb-3">📣</div>
        <h1 className="text-xl font-bold mb-2">¡Gracias por compartir!</h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          Miyagi revisará tu aporte y podría aparecer en la próxima edición impresa de tu colonia.
        </p>
        <div className="mb-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link href="/vecindario" className="inline-flex items-center gap-2 bg-[var(--color-accent)] text-white px-5 py-2 rounded-lg text-sm font-semibold no-underline">
            <i className="iconoir-community" style={{ fontSize: 15 }} />
            {NEIGHBORHOOD_PULSE_COPY.viewFeedCta}
          </Link>
          <Link href="/comunidad/mis-aportes" className="inline-block border border-[var(--color-border)] px-5 py-2 rounded-lg text-sm font-semibold no-underline">
            Ver mis aportes
          </Link>
        </div>
        <div>
          <button onClick={() => location.reload()} className="text-sm text-[var(--color-muted)]">Enviar otro</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">Comparte con tu colonia</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        ¿Una recomendación, un equipo que ganó, una reunión, o solo un saludo? Lo mejor puede salir en la edición impresa. 🗞️
      </p>

      <div className="space-y-4">
        <label className="block">
          <div className="text-sm font-medium mb-1">¿Qué quieres compartir?</div>
          <div className="flex flex-wrap gap-2">
            {PRINT_SOCIAL_TYPES.map((t) => (
              <button key={t.key} type="button" onClick={() => setType(t.key)}
                className={`px-3 py-1.5 rounded-full border text-sm ${type === t.key ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <div className="text-sm font-medium mb-1">Descripción corta</div>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200}
            placeholder="Ej. El equipo Los Pumas ganó la copa de la colonia"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </label>

        <label className="block">
          <div className="text-sm font-medium mb-1">Cuéntanos más <span className="text-[var(--color-muted)] font-normal">· opcional</span></div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </label>

        <label className="block">
          <div className="text-sm font-medium mb-1">Colonia / zona <span className="text-[var(--color-muted)] font-normal">· opcional</span></div>
          <input value={zone} onChange={(e) => setZone(e.target.value)} maxLength={80}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </label>

        <div>
          <div className="text-sm font-medium mb-1">Fotos <span className="text-[var(--color-muted)] font-normal">· hasta 4</span></div>
          <div className="flex flex-wrap gap-2">
            {photos.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-20 w-20 rounded-lg object-cover border border-[var(--color-border)]" />
                <button type="button" onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                  className="absolute -top-2 -right-2 bg-black/70 text-white rounded-full h-5 w-5 text-xs">×</button>
              </div>
            ))}
            {photos.length < 4 && (
              <button type="button" onClick={() => photoInput.current?.click()}
                className="h-20 w-20 rounded-lg border-2 border-dashed border-[var(--color-border)] text-[var(--color-muted)] text-2xl">+</button>
            )}
          </div>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadPhotos(e.target.files)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="button" onClick={submit} disabled={busy}
          className="w-full bg-[var(--color-accent)] text-white rounded-lg py-3 font-semibold disabled:opacity-50">
          {busy ? 'Enviando…' : 'Enviar a la edición'}
        </button>
        <p className="text-xs text-[var(--color-muted)] text-center">Miyagi revisa todo antes de imprimir. Gratis, sin costo.</p>
      </div>
    </div>
  )
}
