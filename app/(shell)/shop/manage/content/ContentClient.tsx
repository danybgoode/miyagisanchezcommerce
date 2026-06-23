'use client'

import { useState } from 'react'
import { SellerBreadcrumb } from '../SellerBreadcrumb'

interface ContentItem {
  id: string
  listing_id: string | null
  title: string
  body: string | null
  file_url: string | null
  file_type: string | null
  is_published: boolean
  created_at: string
}

interface SubListing { id: string; title: string }

export default function ContentClient({
  shopName,
  subscriptionListings,
  initialContent,
}: {
  shopName: string
  subscriptionListings: SubListing[]
  initialContent: ContentItem[]
}) {
  const [items, setItems]       = useState(initialContent)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [formTitle, setFormTitle]     = useState('')
  const [formBody, setFormBody]       = useState('')
  const [formFileUrl, setFormFileUrl] = useState('')
  const [formListingId, setFormListingId] = useState('')
  const [formPublished, setFormPublished] = useState(true)

  function resetForm() {
    setFormTitle('')
    setFormBody('')
    setFormFileUrl('')
    setFormListingId('')
    setFormPublished(true)
    setShowForm(false)
    setError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (formTitle.trim().length < 2) { setError('El título es obligatorio.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/sell/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          body: formBody.trim() || null,
          file_url: formFileUrl.trim() || null,
          listing_id: formListingId || null,
          is_published: formPublished,
        }),
      })
      const data = await res.json() as { contentId?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Error al crear.'); return }

      const newItem: ContentItem = {
        id: data.contentId!,
        listing_id: formListingId || null,
        title: formTitle.trim(),
        body: formBody.trim() || null,
        file_url: formFileUrl.trim() || null,
        file_type: null,
        is_published: formPublished,
        created_at: new Date().toISOString(),
      }
      setItems(prev => [newItem, ...prev])
      resetForm()
    } catch {
      setError('Sin conexión.')
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish(item: ContentItem) {
    const res = await fetch(`/api/sell/content/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_published: !item.is_published }),
    })
    if (res.ok) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_published: !i.is_published } : i))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este contenido?')) return
    setDeleting(id)
    const res = await fetch(`/api/sell/content/${id}`, { method: 'DELETE' })
    if (res.ok) setItems(prev => prev.filter(i => i.id !== id))
    setDeleting(null)
  }

  function getListing(listingId: string | null) {
    return subscriptionListings.find(l => l.id === listingId)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <SellerBreadcrumb />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Contenido exclusivo</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">{shopName} · visible solo para suscriptores activos</p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="shrink-0 bg-[var(--color-accent)] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            + Nuevo post
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="border border-[var(--color-accent)] rounded-xl p-5 space-y-4 bg-green-50/30">
          <p className="font-semibold text-[var(--color-text)]">Nuevo post de contenido</p>

          {error && <p className="text-red-600 text-sm flex items-center gap-1"><span>⚠</span> {error}</p>}

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Título <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Ej: Receta exclusiva de temporada"
              maxLength={200}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Contenido <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
            <textarea
              value={formBody}
              onChange={e => setFormBody(e.target.value)}
              placeholder="Escribe aquí el contenido exclusivo para tus suscriptores..."
              rows={5}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">URL de archivo <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
            <input
              type="url"
              value={formFileUrl}
              onChange={e => setFormFileUrl(e.target.value)}
              placeholder="https://... (imagen, video, PDF...)"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
            />
          </div>

          {subscriptionListings.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Restringir a plan <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
              <select
                value={formListingId}
                onChange={e => setFormListingId(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              >
                <option value="">Todos los suscriptores</option>
                {subscriptionListings.map(l => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formPublished}
              onChange={e => setFormPublished(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text)]">Publicar inmediatamente</span>
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={resetForm}
              className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] py-2.5 rounded-lg text-sm font-medium hover:bg-[var(--color-background)] transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60">
              {saving ? 'Guardando…' : 'Publicar'}
            </button>
          </div>
        </form>
      )}

      {/* Content list */}
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className={`border rounded-xl p-4 space-y-2 ${item.is_published ? 'border-[var(--color-border)]' : 'border-dashed border-[var(--color-border)] opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">{item.title}</p>
                {item.listing_id && (
                  <p className="text-xs text-[var(--color-accent)] mt-0.5">
                    📌 {getListing(item.listing_id)?.title ?? 'Plan específico'}
                  </p>
                )}
                {item.body && (
                  <p className="text-xs text-[var(--color-muted)] mt-1 line-clamp-2">{item.body}</p>
                )}
                {item.file_url && (
                  <a href={item.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[var(--color-accent)] mt-1 flex items-center gap-1 hover:underline">
                    📎 Archivo adjunto
                  </a>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${item.is_published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {item.is_published ? 'Publicado' : 'Borrador'}
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => togglePublish(item)}
                className="text-xs border border-[var(--color-border)] px-3 py-1.5 rounded hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors">
                {item.is_published ? 'Ocultar' : 'Publicar'}
              </button>
              <button type="button" onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded hover:bg-red-50 transition-colors disabled:opacity-60">
                {deleting === item.id ? '…' : 'Eliminar'}
              </button>
            </div>
          </div>
        ))}

        {items.length === 0 && !showForm && (
          <div className="text-center py-16 text-[var(--color-muted)]">
            <p className="text-4xl mb-3">📝</p>
            <p className="font-medium">Aún no hay contenido</p>
            <p className="text-sm mt-1">Publica tu primer post exclusivo para suscriptores.</p>
          </div>
        )}
      </div>
    </div>
  )
}
