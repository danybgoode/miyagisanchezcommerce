'use client'

/**
 * Bookshop launchpad — the shop's manuscript review queue (S1.2). Lists this
 * shop's submissions, opens each manuscript via a short-lived signed-URL
 * download, and moves it through curation (in_review / approved / rejected /
 * changes_requested), which emails the writer. The "Publicar como producto
 * digital" action on approved works is added in S1.3.
 */

import { useEffect, useState } from 'react'
import type { SubmissionStatus } from '@/lib/launchpad-types'

interface SubmissionView {
  id: string
  status: SubmissionStatus
  title: string
  synopsis: string | null
  genre: string | null
  author_name: string
  author_email: string
  manuscript_name: string | null
  manuscript_format: string
  manuscript_size: number | null
  review_note: string | null
  published_product_id: string | null
  created_at: string
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: 'Nuevo',
  in_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  changes_requested: 'Cambios pedidos',
}

const STATUS_COLOR: Record<SubmissionStatus, string> = {
  submitted: 'var(--accent)',
  in_review: 'var(--info)',
  approved: 'var(--success)',
  rejected: 'var(--fg-muted)',
  changes_requested: 'var(--warning)',
}

// Which actions each status offers (mirrors the server state machine).
function actionsFor(status: SubmissionStatus): SubmissionStatus[] {
  switch (status) {
    case 'submitted': return ['in_review', 'approved', 'changes_requested', 'rejected']
    case 'in_review': return ['approved', 'changes_requested', 'rejected']
    case 'changes_requested': return ['rejected']
    case 'approved': return ['changes_requested']
    case 'rejected': return []
  }
}

const ACTION_LABEL: Record<SubmissionStatus, string> = {
  in_review: 'Empezar revisión',
  approved: 'Aprobar',
  changes_requested: 'Pedir cambios',
  rejected: 'Rechazar',
  submitted: '',
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function SubmissionsQueue() {
  const [items, setItems] = useState<SubmissionView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/sell/launchpad/submissions')
      const data = await res.json().catch(() => ({})) as { submissions?: SubmissionView[] }
      setItems(data.submissions ?? [])
    } catch {
      setError('No se pudieron cargar los manuscritos.')
    }
  }

  useEffect(() => { load() }, [])

  async function publish(item: SubmissionView) {
    setBusyId(item.id)
    setError(null)
    try {
      const res = await fetch(`/api/sell/launchpad/submissions/${item.id}/publish`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { error?: string; manage_url?: string }
      if (!res.ok) { setError(data.error ?? 'No se pudo publicar.'); return }
      await load()
      if (data.manage_url) window.location.href = data.manage_url
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  async function act(item: SubmissionView, to: SubmissionStatus) {
    let note: string | null = null
    if (to === 'rejected' || to === 'changes_requested') {
      const prompt_ = to === 'rejected'
        ? 'Mensaje para el autor (por qué no sigue adelante):'
        : 'Qué debe ajustar el autor antes de reenviar:'
      note = window.prompt(prompt_)?.trim() || null
      if (!note) return // required — cancelled
    }
    setBusyId(item.id)
    setError(null)
    try {
      const res = await fetch(`/api/sell/launchpad/submissions/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to, note }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(data.error ?? 'No se pudo actualizar.'); return }
      await load()
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  if (items === null) {
    return <p className="text-sm text-[var(--color-muted)]">Cargando manuscritos…</p>
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Manuscritos recibidos</h2>
      <p className="text-sm text-[var(--color-muted)] mb-4">{items.length} en total</p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {items.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-[var(--r-md)] p-6 text-center text-sm text-[var(--color-muted)]">
          Aún no recibes manuscritos. Comparte tu página de convocatoria para empezar.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="border border-[var(--color-border)] rounded-[var(--r-md)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[var(--r-pill)]"
                      style={{ color: STATUS_COLOR[item.status], border: `1px solid ${STATUS_COLOR[item.status]}` }}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    {item.genre && <span className="text-xs text-[var(--color-muted)]">{item.genre}</span>}
                  </div>
                  <h3 className="font-semibold mt-1.5">{item.title}</h3>
                  <p className="text-sm text-[var(--color-muted)]">
                    {item.author_name} · <a href={`mailto:${item.author_email}`} className="underline">{item.author_email}</a>
                  </p>
                </div>
                <a
                  href={`/api/sell/launchpad/submissions/${item.id}/download`}
                  target="_blank" rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] no-underline hover:bg-[var(--color-surface-alt)]"
                >
                  <i className="iconoir-download" style={{ fontSize: 14 }} />
                  {item.manuscript_format.toUpperCase()}{item.manuscript_size ? ` · ${formatSize(item.manuscript_size)}` : ''}
                </a>
              </div>

              {item.synopsis && (
                <p className="text-sm mt-3 leading-relaxed whitespace-pre-line">{item.synopsis}</p>
              )}

              {item.review_note && (
                <p className="text-xs mt-3 p-2 rounded-[var(--r-md)] bg-[var(--color-surface-alt)] text-[var(--color-muted)]">
                  <strong>Tu nota al autor:</strong> {item.review_note}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {/* Publish flow (S1.3) — approved works mint a draft digital product. */}
                {item.status === 'approved' && !item.published_product_id && (
                  <button
                    onClick={() => publish(item)}
                    disabled={busyId === item.id}
                    className="text-sm px-3 py-1.5 rounded-[var(--r-md)] bg-[var(--color-accent)] text-white font-semibold disabled:opacity-50"
                  >
                    Publicar como producto digital
                  </button>
                )}
                {item.status === 'approved' && item.published_product_id && (
                  <a
                    href="/shop/manage/catalogo"
                    className="text-sm px-3 py-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] font-medium no-underline hover:bg-[var(--color-surface-alt)]"
                  >
                    Editar borrador y activar →
                  </a>
                )}
                {actionsFor(item.status).map(to => (
                  <button
                    key={to}
                    onClick={() => act(item, to)}
                    disabled={busyId === item.id}
                    className="text-sm px-3 py-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] font-medium disabled:opacity-50 hover:bg-[var(--color-surface-alt)]"
                  >
                    {ACTION_LABEL[to]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
