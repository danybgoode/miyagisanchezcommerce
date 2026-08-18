'use client'

/**
 * Living Shop — Wall management (epic 07, Stories 1.4 + 5.2).
 *
 * The list and its actions. Composing lives in `WallComposer.tsx`; the two split
 * because the composer is the only stateful form here and keeping them together
 * is how a settings component starts growing.
 *
 * Every action is optimistic-free on purpose: the server's returned row replaces
 * the local one, so what the seller sees after an action is what was persisted,
 * not what was requested. A pin that the database refused would otherwise show as
 * applied.
 */

import { useState } from 'react'
import { Toast, useToast } from '@/components/feedback/Toast'
import WallComposer from './WallComposer'
import { effectiveInstant } from '@/lib/wall/visibility'
import type { WallEntry, WallStatus } from '@/lib/wall/types'
import type { WallTabProps } from './types'

const STATUS_LABEL: Record<WallStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  scheduled: 'Programada',
}

const KIND_LABEL: Record<WallEntry['kind'], string> = {
  post: 'Nota',
  product: 'Producto',
  collection: 'Colección',
  event: 'Evento',
}

/** The seller's own timezone, spelled out — a bare date is the ambiguity S1.2 forbids. */
function localInstant(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  }).format(new Date(ms))
}

export default function WallTab({ shop, objects, initialEntries }: WallTabProps) {
  const [entries, setEntries] = useState<WallEntry[]>(initialEntries)
  const [editing, setEditing] = useState<WallEntry | null>(null)
  const [composing, setComposing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast()

  const replace = (entry: WallEntry) =>
    setEntries((prev) => {
      const next = prev.some((e) => e.id === entry.id)
        ? prev.map((e) => (e.id === entry.id ? entry : e))
        : [entry, ...prev]
      // A new pin clears every other one server-side; mirror that here or the
      // list would show two pinned rows until the next reload.
      return entry.pinned ? next.map((e) => (e.id === entry.id ? e : { ...e, pinned: false })) : next
    })

  async function act(entry: WallEntry, patch: Record<string, unknown>) {
    setBusyId(entry.id)
    try {
      const res = await fetch(`/api/sell/wall/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? 'No se pudo guardar.', 'error')
        return
      }
      replace(data.entry as WallEntry)
      showToast('Listo.', 'success')
    } catch {
      showToast('Sin conexión. Intenta de nuevo.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(entry: WallEntry) {
    setBusyId(entry.id)
    try {
      const res = await fetch(`/api/sell/wall/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error ?? 'No se pudo borrar.', 'error')
        return
      }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id))
      showToast('Publicación borrada.', 'success')
    } finally {
      setBusyId(null)
    }
  }

  if (composing || editing) {
    return (
      <WallComposer
        objects={objects}
        entry={editing}
        onCancel={() => { setComposing(false); setEditing(null) }}
        onSaved={(entry) => {
          replace(entry)
          setComposing(false)
          setEditing(null)
          showToast('Guardado.', 'success')
        }}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-[var(--fg-muted)]">
          Tu muro es la portada de <strong>{shop.name}</strong>.
        </p>
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="px-3.5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
        >
          <i className="iconoir-plus" aria-hidden /> Crear publicación
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] rounded-xl p-8 text-center">
          <p className="font-medium mb-1">Tu muro está vacío</p>
          <p className="text-sm text-[var(--fg-muted)] max-w-md mx-auto">
            Publica una <strong>nota</strong> para contar algo, un <strong>producto</strong> para
            destacarlo, una <strong>colección</strong> para armar una historia o un{' '}
            <strong>evento</strong> para invitar a tu gente.
          </p>
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="mt-4 px-3.5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
          >
            Crear publicación
          </button>
        </div>
      ) : (
        <ul className="space-y-2 list-none p-0 m-0">
          {entries.map((entry) => (
            <li key={entry.id} className="border border-[var(--border)] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-sunk)] text-[var(--fg-muted)]">
                      {KIND_LABEL[entry.kind]}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full ${
                        entry.status === 'published' ? 'bg-green-50 text-green-700'
                          : entry.status === 'scheduled' ? 'bg-amber-50 text-amber-700'
                          : 'bg-[var(--bg-sunk)] text-[var(--fg-muted)]'
                      }`}
                    >
                      {STATUS_LABEL[entry.status]}
                    </span>
                    {entry.pinned && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                        <i className="iconoir-pin" aria-hidden /> Fijada
                      </span>
                    )}
                    <span className="text-[var(--fg-muted)]">{localInstant(effectiveInstant(entry) ?? entry.created_at)}</span>
                  </div>
                  <p className="text-sm mt-1.5 line-clamp-2">
                    {entry.body || (entry.reference_id ? <span className="text-[var(--fg-muted)]">{entry.reference_id}</span> : '—')}
                  </p>
                </div>
              </div>

              <div className="flex gap-1.5 flex-wrap mt-3">
                <button type="button" disabled={busyId === entry.id} onClick={() => setEditing(entry)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)]">
                  Editar
                </button>
                {entry.status !== 'published' ? (
                  <button type="button" disabled={busyId === entry.id} onClick={() => act(entry, { status: 'published' })}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)]">
                    Publicar ahora
                  </button>
                ) : (
                  <button type="button" disabled={busyId === entry.id} onClick={() => act(entry, { status: 'draft', pinned: false })}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)]">
                    Quitar de la tienda
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === entry.id || entry.status === 'draft'}
                  title={entry.status === 'draft' ? 'Publica o programa la publicación antes de fijarla.' : undefined}
                  onClick={() => act(entry, { pinned: !entry.pinned })}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] disabled:opacity-50"
                >
                  {entry.pinned ? 'Desfijar' : 'Fijar arriba'}
                </button>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => { if (confirm('¿Borrar esta publicación? No se puede deshacer.')) remove(entry) }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-red-600"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
