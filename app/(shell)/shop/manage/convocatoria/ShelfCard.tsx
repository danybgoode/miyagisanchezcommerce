'use client'

/**
 * ShelfCard — the "Convocatoria" launchpad-shelf suggestion (bookshop-launchpad
 * S2.2). Fetches the suggestion state on mount; when the shop has published
 * launchpad works not yet gathered into a Convocatoria collection, it offers a
 * one-tap "crear estante" that creates the collection (if needed) and adds the
 * works. Suggestion, never forced — the seller confirms. Hidden once everything
 * is shelved (nothing to suggest).
 */

import { useEffect, useState } from 'react'

interface ShelfState {
  suggest: boolean
  total_works?: number
  missing?: number
  collection_url?: string | null
}

export default function ShelfCard() {
  const [state, setState] = useState<ShelfState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ assigned: number; url: string | null } | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/sell/launchpad/shelf')
      .then((r) => r.json())
      .then((d: ShelfState) => { if (alive) setState(d) })
      .catch(() => { if (alive) setState({ suggest: false }) })
    return () => { alive = false }
  }, [])

  async function createShelf() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/sell/launchpad/shelf', { method: 'POST' })
      const d = await res.json() as { assigned?: number; collection_url?: string | null; error?: string }
      if (!res.ok) { setError(d.error ?? 'No se pudo crear el estante. Inténtalo de nuevo.'); return }
      setDone({ assigned: d.assigned ?? 0, url: d.collection_url ?? null })
    } catch {
      setError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  // Success state — persists after the (now empty) suggestion clears.
  if (done) {
    return (
      <div style={{ border: '1px solid var(--success)', borderRadius: 'var(--r-lg)', padding: 16, background: 'var(--bg-sunk)' }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>
          ✓ Estante Convocatoria listo
        </p>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>
          {done.assigned > 0
            ? `Agregamos ${done.assigned} ${done.assigned === 1 ? 'obra' : 'obras'} a tu estante Convocatoria.`
            : 'Tu estante Convocatoria ya está al día.'}
          {' '}Aparece como una sección en tu tienda.
        </p>
        {done.url && (
          <a href={done.url} target="_blank" rel="noreferrer"
             style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
            Ver estante ↗
          </a>
        )}
      </div>
    )
  }

  if (!state?.suggest) return null

  const n = state.total_works ?? 0
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16, background: 'var(--bg-sunk)' }}>
      <p style={{ fontSize: 14, fontWeight: 700 }}>Crea tu estante «Convocatoria»</p>
      <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>
        Agrupa {n === 1 ? 'tu obra publicada' : `tus ${n} obras publicadas`} de la convocatoria en una
        sección propia de tu tienda, para que los lectores las encuentren juntas. Tú decides — puedes
        editar o quitar la colección cuando quieras.
      </p>
      {error && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>{error}</p>}
      <button
        type="button"
        onClick={createShelf}
        disabled={busy}
        style={{
          marginTop: 12,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--fg-inverse)',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 'var(--r-md)',
          padding: '8px 14px',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Creando…' : 'Crear estante Convocatoria'}
      </button>
    </div>
  )
}
