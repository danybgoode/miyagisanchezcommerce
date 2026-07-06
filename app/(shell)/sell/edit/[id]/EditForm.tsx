'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AttrsSection, type Attrs, type ListingType } from '../../AttrsSection'
import { ESTADOS, ESTADO_INEGI_BY_NAME } from '@/lib/mx-locations'
import { CITIES_BY_STATE } from '@/lib/types'
import PersonalizationSection from './PersonalizationSection'
import OpcionesSection from './OpcionesSection'
import { sanitizeFieldDefs, type CustomFieldDef } from '@/lib/personalization'
import { SlugField, type SlugStatus } from '@/components/SlugField'
import type { PriceGrid } from '@/lib/price-grid'

interface ShortlinkInfo {
  shopSlug: string
  /** Auto short code (always present after backfill). */
  code: string
  /** Seller-set custom slug (optional, preferred over the code). */
  slug: string
}

interface EditableFields {
  title: string
  description: string
  price_cents: number | null
  currency: string
  listing_type: string
  category: string
  attrs: Record<string, unknown>
  custom_fields?: unknown
  available_quantity: number | null
  images: Array<{ url: string; alt?: string }>
  state?: string
  municipio?: string
  estado_code?: string
}

export default function EditForm({
  id,
  initial,
  shortlink,
  priceGrid = null,
  isActive = false,
}: {
  id: string
  initial: EditableFields
  shortlink?: ShortlinkInfo
  /** The listing's live price-grid (same route the PDP reads); null when unavailable. */
  priceGrid?: PriceGrid | null
  /** Supabase mirror status === 'active' (Medusa: published). */
  isActive?: boolean
}) {
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
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>(
    () => sanitizeFieldDefs(initial.custom_fields),
  )
  const [listingState, setListingState] = useState(initial.state ?? '')
  const [listingCity, setListingCity] = useState(initial.municipio ?? '')
  const hasLegacyLocation = !!(initial.state && !initial.estado_code)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  // Product short link (mschz.org/[slug || code]) — US-3b/US-4
  const [shortSlug, setShortSlug] = useState(shortlink?.slug ?? '')
  const [shortStatus, setShortStatus] = useState<SlugStatus>('idle')
  const [shortCopied, setShortCopied] = useState(false)
  const shortSeg = shortSlug.trim() || shortlink?.code || ''
  const shortUrl = shortSeg ? `mschz.org/${shortSeg}` : ''

  const isSubscription = initial.listing_type === 'subscription'
  const isDigital = initial.listing_type === 'digital'
  const isProduct = initial.listing_type === 'product'
  const priceReadOnly = isSubscription

  // Opciones (custom-print-products Story 2.4): a multi-variant listing has no
  // single flat price/stock — the backend 422s a bare `price_cents`/`quantity`
  // ("especifica variant_id"), and a tiered sole variant 422s `price_cents`
  // ("usa variant_tiers"). Hide those legacy inputs and route everything
  // through the Opciones section instead of letting the save fail.
  const isMultiVariant = (priceGrid?.variants.length ?? 0) > 1
  const soleVariantHasTiers = priceGrid?.variants.length === 1 && priceGrid.variants[0].tiers.length > 1
  const hideFlatPrice = isMultiVariant || soleVariantHasTiers
  const hideFlatQuantity = isMultiVariant

  function parsePriceCents(raw: string): number | null {
    const n = parseFloat(raw.replace(/,/g, '').replace(/\s/g, ''))
    if (isNaN(n) || n <= 0) return null
    return Math.round(n * 100)
  }

  async function handleSave() {
    const errs: Record<string, string> = {}
    if (title.trim().length < 5) errs.title = 'El título debe tener al menos 5 caracteres.'
    if (title.trim().length > 100) errs.title = 'El título no puede superar los 100 caracteres.'
    if (!priceReadOnly && !hideFlatPrice && priceRaw) {
      const cents = parsePriceCents(priceRaw)
      if (cents !== null && cents <= 0) errs.price = 'El precio debe ser mayor a $0.'
    }
    if (shortStatus === 'taken' || shortStatus === 'invalid') {
      errs.short_slug = 'Corrige el enlace corto antes de guardar.'
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
        attrs: Object.fromEntries(
          Object.entries(attrs).filter(([, v]) => v !== '' && v !== null && v !== undefined)
        ),
        state: listingState || null,
        estado_code: listingState ? ESTADO_INEGI_BY_NAME[listingState] : null,
        municipio: listingCity.trim() || null,
        custom_fields: sanitizeFieldDefs(customFields),
        ...(shortlink ? { short_slug: shortSlug.trim() || null } : {}),
      }
      if (!priceReadOnly && !hideFlatPrice) {
        body.price_cents = priceRaw ? parsePriceCents(priceRaw) : null
      }
      if (isProduct && !hideFlatQuantity && quantityRaw.trim() !== '') {
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

      {/* Personalization fields — buyer-entered custom inputs (not for subscriptions) */}
      {!isSubscription && (
        <PersonalizationSection fields={customFields} setFields={setCustomFields} />
      )}

      {/* Opciones — priced dimensions + quantity tiers (products only; Story 2.4) */}
      {isProduct && (
        <OpcionesSection priceGrid={priceGrid} isActive={isActive} currency={initial.currency} />
      )}

      {/* Short link (mschz.org) — copy + optional custom slug (US-3b / US-4) */}
      {shortlink && (
        <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface-alt)]">
          <h3 className="text-sm font-medium mb-1">Enlace corto del producto</h3>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 min-w-0 truncate text-sm font-mono bg-white border border-[var(--color-border)] rounded px-3 py-2">
              {shortUrl}
            </code>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(`https://${shortUrl}`); setShortCopied(true); setTimeout(() => setShortCopied(false), 2000) }}
              className={`text-xs px-3 py-2 rounded transition-colors whitespace-nowrap ${shortCopied ? 'bg-green-100 text-green-700' : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-white'}`}
            >
              {shortCopied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-2">
            Compártelo en redes y mensajes. Por defecto usa un código; personalízalo si quieres:
          </p>
          <div className="mt-3">
            <SlugField
              value={shortSlug}
              onChange={setShortSlug}
              currentSlug={shortlink.slug || undefined}
              onStatusChange={setShortStatus}
              label="Personaliza el enlace (opcional)"
              prefix="mschz.org/"
              checkUrl={`/api/sell/shortlink/check?excludeListing=${id}`}
              placeholder={shortlink.code}
              successText="¡Disponible!"
            />
            {fieldErrors.short_slug && <p className="text-xs text-red-600 mt-1">{fieldErrors.short_slug}</p>}
          </div>
        </div>
      )}

      {/* Price — hidden for multi-variant/tiered listings (managed per combination above) */}
      {!priceReadOnly && !hideFlatPrice && (
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

      {/* Quantity / restock — hidden for multi-variant listings (per-combination stock) */}
      {isProduct && !hideFlatQuantity && (
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

      {/* Location */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
          Ubicación / Location
        </label>
        {hasLegacyLocation && !listingState && (
          <div className="mb-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
            ⚠ Actualizar ubicación / Update location — tu anuncio tiene una ubicación guardada como texto libre (&quot;{initial.state}&quot;). Selecciona el estado correcto para que aparezca en los filtros de búsqueda.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <select
            value={listingState}
            onChange={e => { setListingState(e.target.value); setListingCity('') }}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
          >
            <option value="">Estado / State (opcional)</option>
            {ESTADOS.map(e => (
              <option key={e.inegi_code} value={e.name}>{e.name}</option>
            ))}
          </select>
          <select
            value={listingCity}
            onChange={e => setListingCity(e.target.value)}
            disabled={!listingState}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">{listingState ? 'Municipio (opcional)' : 'Primero elige estado'}</option>
            {(CITIES_BY_STATE[listingState] ?? []).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

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
