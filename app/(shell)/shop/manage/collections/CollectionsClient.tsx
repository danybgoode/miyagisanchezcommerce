'use client'

import { useState, useCallback } from 'react'
import { SellerBreadcrumb } from '../SellerBreadcrumb'

export interface Collection {
  id: string
  handle: string
  name: string
  sort_order: number
}

export default function CollectionsClient({ shopName, initialCollections }: { shopName: string; initialCollections: Collection[] }) {
  const [collections, setCollections] = useState<Collection[]>(initialCollections)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sell/collections')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'Error al cargar colecciones.')
      setCollections(data.collections ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar colecciones.')
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const trimmed = name.trim()
    if (trimmed.length < 2) { setFormError('El nombre debe tener al menos 2 caracteres.'); return }

    setCreating(true)
    try {
      const res = await fetch('/api/sell/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'No se pudo crear la colección.')
      setName('')
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo crear la colección.')
    } finally {
      setCreating(false)
    }
  }

  async function remove(c: Collection) {
    if (!confirm(`¿Eliminar la colección "${c.name}"? Tus anuncios NO se eliminan, solo dejan de estar agrupados aquí.`)) return
    setCollections(prev => prev.filter(x => x.id !== c.id))
    const res = await fetch(`/api/sell/collections/${c.id}`, { method: 'DELETE' })
    if (!res.ok) { await load() }
  }

  function startRename(c: Collection) {
    setRenamingId(c.id)
    setRenameValue(c.name)
  }

  async function commitRename(c: Collection) {
    const trimmed = renameValue.trim()
    setRenamingId(null)
    if (!trimmed || trimmed === c.name) return
    setCollections(prev => prev.map(x => x.id === c.id ? { ...x, name: trimmed } : x))
    const res = await fetch(`/api/sell/collections/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    if (!res.ok) { await load() }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= collections.length) return
    const reordered = [...collections]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    setCollections(reordered)

    const res = await fetch('/api/sell/collections/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: reordered.map(c => c.id) }),
    })
    if (!res.ok) { await load() }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <SellerBreadcrumb className="mb-1" />
      <h1 className="text-2xl font-bold mb-1">Colecciones</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Agrupa los anuncios de {shopName} en secciones propias (Die-cut, Zines…) — aparecen como una barra de navegación en tu tienda.
      </p>

      <form onSubmit={handleCreate} className="border border-[var(--color-border)] rounded-[var(--r-md)] p-5 mb-8">
        <h2 className="font-semibold mb-4">Nueva colección</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Die-cut"
            maxLength={60}
            className="flex-1 border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm bg-[var(--color-background)]"
          />
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 text-sm font-medium rounded-[var(--r-md)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {creating ? 'Creando…' : 'Crear'}
          </button>
        </div>
        {formError && <p className="text-sm text-red-600 mt-3">{formError}</p>}
      </form>

      <h2 className="font-semibold mb-3">Tus colecciones</h2>
      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : collections.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Aún no tienes colecciones. Crea la primera arriba.</p>
      ) : (
        <ul className="space-y-2">
          {collections.map((c, i) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 border border-[var(--color-border)] rounded-[var(--r-md)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                {renamingId === c.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(c)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(c); if (e.key === 'Escape') setRenamingId(null) }}
                    maxLength={60}
                    className="w-full border border-[var(--color-border)] rounded-[var(--r-md)] px-2 py-1 text-sm bg-[var(--color-background)]"
                  />
                ) : (
                  <button onClick={() => startRename(c)} className="font-semibold text-left hover:underline">
                    {c.name}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-30"
                  title="Subir"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === collections.length - 1}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-30"
                  title="Bajar"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(c)}
                  className="text-xs text-red-600 hover:text-red-700"
                  title="Eliminar"
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
