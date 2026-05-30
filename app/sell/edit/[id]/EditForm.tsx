'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AttrsSection, type Attrs, type ListingType } from '../../AttrsSection'

interface EditableFields {
  title: string
  description: string
  price_cents: number | null
  currency: string
  listing_type: string
  category: string
  attrs: Record<string, unknown>
  available_quantity: number | null
  images: Array<{ url: string; alt?: string }>
}

export default function EditForm({ id, initial }: { id: string; initial: EditableFields }) {
  const router = useRouter()
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description ?? '')
  const [priceRaw, setPriceRaw] = useState(
    initial.price_cents != null ? String(initial.price_cents / 100) : '',
  )
  const [quantityRaw, setQuantityRaw] = useState(
    initial.available_quantity != null ? String(initial.available_quantity) : '',
  )
  const [attrs, setAttrs] = useState<Attrs>(
    Object.fromEntries(
      Object.entries(initial.attrs ?? {}).map(([k, v]) => [k, String(v ?? '')])
    )
  )
  function setAttr(k: string, v: string) {
    setAttrs(prev => ({ ...prev, [k]: v }))
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const isSubscription = initial.listing_type === 'subscription'
  const isDigital = initial.listing_type === 'digital'
  const isProduct = initial.listing_type === 'product'
  const priceReadOnly = isSubscription

  function parsePriceCents(raw: string): number | null {
    const n = parseFloat(raw.replace(/,/g, '').replace(/\s/g, ''))
    if (isNaN(n) || n <= 0) return null
    return Math.round(n * 100)
  }

  async function handleSave() {
    const errs: Record<string, string> = {}
    if (title.trim().length < 5) errs.title = 'El título debe tener al menos 5 caracteres.'
    if (title.trim().length > 100) errs.title = 'El título no puede superar los 100 caracteres.'
    if (!priceReadOnly && priceRaw) {
      const cents = parsePriceCents(priceRaw)
      if (cents !== null && cents <= 0) errs.price = 'El precio debe ser mayor a $0.'
    }
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        // Non-empty attrs only
        attrs: Object.fromEntries(
          Object.entries(attrs).filter(([, v]) => v !== '' && v !== null && v !== undefined)
        ),
      }
      if (!priceReadOnly) {
        body.price_cents = priceRaw ? parsePriceCents(priceRaw) : null
      }
      if (isProduct && quantityRaw.trim() !== '') {
        body.quantity = Math.max(0, parseInt(quantityRaw) || 0)
      }

      const res = await fetch(`/api/sell/listing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { updated?: boolean; error?: string; field?: string }

      if (!res.ok) {
        if (data.field) setFieldErrors(prev => ({ ...prev, [data.field!]: data.error! }))
        else setError(data.error ?? 'Error al guardar los cambios.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm flex items-start gap-2">
          <span className="mt-0.5 shrink-0">⚠</span>
          <p>{error}</p>
        </div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded px-4 py-3 text-sm flex items-center gap-2">
          <span>✓</span>
          <p>Cambios guardados correctamente.</p>
        </div>
      )}

      {/* Images preview */}
      {initial.images.length > 0 && (
        <div>
          <p className="text-sm font-medium text-[var(--color-text)] mb-2">Fotos actuales</p>
          <div className="flex gap-2 flex-wrap">
            {initial.images.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt={img.alt ?? ''}
                className="w-20 h-20 object-cover rounded-md border border-[var(--color-border)]"
              />
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Para cambiar las fotos, elimina este anuncio y crea uno nuevo.
          </p>
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
          Título <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={100}
          className={`w-full border rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition ${
            fieldErrors.title ? 'border-red-400' : 'border-[var(--color-border)]'
          }`}
        />
        {fieldErrors.title && <p className="text-red-600 text-xs mt-1">{fieldErrors.title}</p>}
        <p className="text-xs text-[var(--color-muted)] mt-1">{title.length}/100</p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Descripción</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={5}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition resize-y"
          placeholder="Describe tu anuncio..."
        />
      </div>

      {/* Category-specific attrs */}
      {initial.category && (
        <AttrsSection
          category={initial.category}
          listingType={initial.listing_type as ListingType}
          attrs={attrs}
          setAttr={setAttr}
        />
      )}

      {/* Price */}
      {!priceReadOnly && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Precio ({initial.currency})
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-sm">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={priceRaw}
              onChange={e => setPriceRaw(e.target.value)}
              placeholder="0.00"
              className={`w-full border rounded pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition ${
                fieldErrors.price ? 'border-red-400' : 'border-[var(--color-border)]'
              }`}
            />
          </div>
          {fieldErrors.price && <p className="text-red-600 text-xs mt-1">{fieldErrors.price}</p>}
          {isDigital && <p className="text-xs text-[var(--color-muted)] mt-1">Precio por descarga única.</p>}
        </div>
      )}
      {isSubscription && (
        <div className="bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-muted)]">
          💡 Los precios de suscripción se gestionan en los planes del anuncio.
        </div>
      )}

      {/* Quantity / restock */}
      {isProduct && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Cantidad disponible
          </label>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={quantityRaw}
            onChange={e => setQuantityRaw(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            className={`w-32 border rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition ${
              fieldErrors.quantity ? 'border-red-400' : 'border-[var(--color-border)]'
            }`}
          />
          {fieldErrors.quantity && <p className="text-red-600 text-xs mt-1">{fieldErrors.quantity}</p>}
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Pon 0 para marcar como agotado. No afecta pedidos en curso.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-[var(--color-accent)] text-white font-semibold py-3 rounded-lg text-sm hover:bg-[var(--color-accent-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Guardando…' : '✓ Guardar cambios'}
      </button>
    </div>
  )
}
