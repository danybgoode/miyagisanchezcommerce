'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core'
import type { SeleccionCandidate } from '@/app/api/admin/seleccion/route'

/**
 * Homepage Selección curation (S2.2). Lists the freshest candidate products with
 * a pin toggle; pinned rows are drag-reorderable (the order = `featured_rank`,
 * asc → the lowest-rank pin becomes the homepage "Destacado"). Saves through
 * `PATCH /api/admin/seleccion/[id]`; the homepage reflects changes within its ISR
 * window (~60s). Same-origin fetches carry the Clerk session cookie (no secret).
 */

type Candidate = SeleccionCandidate

function priceLabel(c: Candidate): string {
  if (c.price_cents == null) return 'Sin precio'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: c.currency || 'MXN' }).format(c.price_cents / 100)
}

/** Move the item at `from` to `to`, returning a new array (stable for the rest). */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export default function SeleccionAdminClient() {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/seleccion')
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const d = (await r.json()) as { candidates: Candidate[] }
      setCandidates(d.candidates ?? [])
      setError(null)
    } catch (e) {
      setError(`No se pudo cargar la lista: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // Pinned first (by rank asc, then fresh), then the unpinned candidate pool.
  const pinned = useMemo(
    () => candidates
      .filter(c => c.pinned)
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || +new Date(b.created_at) - +new Date(a.created_at)),
    [candidates],
  )
  const unpinned = useMemo(() => candidates.filter(c => !c.pinned), [candidates])

  const patch = useCallback(async (id: string, body: { featured: boolean; featured_rank: number | null }) => {
    const r = await fetch(`/api/admin/seleccion/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(d.error ?? `Error ${r.status}`)
    }
  }, [])

  // Pin: append after the current pins. Unpin: clear featured (rank cleared server-side).
  async function togglePin(c: Candidate) {
    setBusy(true); setError(null)
    try {
      if (c.pinned) await patch(c.id, { featured: false, featured_rank: null })
      else await patch(c.id, { featured: true, featured_rank: pinned.length + 1 })
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Drag-reorder the pinned list → renumber ranks 1..n and persist each.
  async function reorder(from: number, to: number) {
    if (from === to) return
    const next = arrayMove(pinned, from, to)
    // Optimistic: reflect the new order immediately.
    setCandidates(prev => prev.map(c => {
      const idx = next.findIndex(p => p.id === c.id)
      return idx === -1 ? c : { ...c, rank: idx + 1 }
    }))
    setBusy(true); setError(null)
    try {
      await Promise.all(next.map((c, i) => patch(c.id, { featured: true, featured_rank: i + 1 })))
      await load()
    } catch (e) {
      setError(String(e))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || activeId === overId) return
    const from = pinned.findIndex(p => p.id === activeId)
    const to = pinned.findIndex(p => p.id === overId)
    if (from === -1 || to === -1) return
    void reorder(from, to)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Selección de la semana</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Fija productos en la “Selección de la semana” de la página de inicio y ordénalos
          arrastrándolos. El de menor orden es el <strong>Destacado</strong>. Los cambios se reflejan
          en la página de inicio en ~1 minuto.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* ── Pinned (drag-reorderable) ─────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Fijados {pinned.length > 0 && `(${pinned.length})`}
        </h2>
        {pinned.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            Nada fijado — la Selección se cura sola (lo más fresco). Fija algo abajo para tomar el control.
          </p>
        )}
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <ul className="space-y-2">
            {pinned.map((c, i) => (
              <PinnedRow key={c.id} c={c} order={i + 1} featured={i === 0}
                onTogglePin={() => togglePin(c)} disabled={busy} />
            ))}
          </ul>
        </DndContext>
      </section>

      {/* ── Candidate pool ────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Candidatos
        </h2>
        {loading && <p className="text-sm text-[var(--color-muted)]">Cargando…</p>}
        {!loading && unpinned.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">Sin candidatos recientes.</p>
        )}
        <ul className="space-y-2">
          {unpinned.map(c => (
            <li key={c.id} className="flex items-center gap-3 border border-[var(--color-border)] rounded-xl p-2">
              <Thumb c={c} />
              <CardText c={c} />
              <button onClick={() => togglePin(c)} disabled={busy}
                className="text-xs font-semibold text-[var(--color-accent)] disabled:opacity-50 shrink-0">
                Fijar
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function PinnedRow({ c, order, featured, onTogglePin, disabled }: {
  c: Candidate; order: number; featured: boolean; onTogglePin: () => void; disabled: boolean
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id: c.id })
  const { setNodeRef: setDragRef, listeners, attributes, transform, isDragging } = useDraggable({ id: c.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 40, opacity: 0.85 }
    : undefined
  return (
    <li ref={setDropRef}>
      <div ref={setDragRef} style={style}
        className="flex items-center gap-3 border border-[var(--color-border)] rounded-xl p-2 bg-[var(--color-bg)]">
        <button {...listeners} {...attributes} aria-label="Reordenar"
          className="cursor-grab touch-none text-[var(--color-muted)] px-1 shrink-0"
          disabled={disabled}>
          <span aria-hidden className="iconoir-menu text-lg" />
        </button>
        <span className="text-xs font-mono w-5 text-center shrink-0">{order}</span>
        <Thumb c={c} />
        <CardText c={c} />
        {featured && (
          <span className="text-[10px] uppercase tracking-wide bg-[var(--color-accent)] text-white rounded px-1.5 py-0.5 shrink-0">
            Destacado
          </span>
        )}
        <button onClick={onTogglePin} disabled={disabled || isDragging}
          className="text-xs font-semibold text-red-600 disabled:opacity-50 shrink-0">
          Quitar
        </button>
      </div>
    </li>
  )
}

function Thumb({ c }: { c: Candidate }) {
  if (!c.image) return <div className="h-12 w-12 rounded bg-[var(--color-bg-sunk)] border border-[var(--color-border)] shrink-0" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={c.image} alt="" className="h-12 w-12 rounded object-cover border border-[var(--color-border)] shrink-0" />
}

function CardText({ c }: { c: Candidate }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-medium text-sm truncate">{c.title}</div>
      <div className="text-xs text-[var(--color-muted)] truncate">
        {priceLabel(c)}{c.shop_name && ` · ${c.shop_name}`}
      </div>
    </div>
  )
}
