'use client'

import React, { useState, useRef, useCallback, useId, useEffect } from 'react'
import { CATEGORIES, CITIES_BY_STATE } from '@/lib/types'
import { ESTADOS, ESTADO_INEGI_BY_NAME } from '@/lib/mx-locations'
import { AttrsSection, type Attrs } from './AttrsSection'
import { SlugField, type SlugStatus } from '@/components/SlugField'
import { slugify } from '@/lib/slug'
import { Banner } from '@/components/feedback/Banner'

// ── Types ────────────────────────────────────────────────────────────────────

interface ExistingShop {
  id: string
  slug: string
  name: string
  location: string | null
}

interface UploadedPhoto {
  localId: string          // stable key for React
  localUrl: string         // blob URL, shown immediately
  remoteUrl: string | null // Supabase URL once uploaded
  status: 'uploading' | 'done' | 'error'
  errorMsg?: string
}

type ListingType = 'product' | 'service' | 'rental' | 'digital' | 'subscription'

// ── Canvas image compression ──────────────────────────────────────────────────
// Runs entirely client-side: resize to ≤1920px wide, convert to WebP at 0.82 quality.
// Falls back to the original file if canvas is unavailable (SSR, old browser).

async function compressImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || !window.createImageBitmap) return file
  // Skip tiny files — no benefit compressing images already under 200KB
  if (file.size < 200 * 1024 && file.type === 'image/webp') return file

  try {
    const bitmap = await createImageBitmap(file)
    const MAX_DIM = 1920
    let { width, height } = bitmap
    if (width > MAX_DIM || height > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
      width  = Math.round(width  * ratio)
      height = Math.round(height * ratio)
    }

    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', 0.82),
    )
    if (!blob) return file

    const compressed = new File(
      [blob],
      file.name.replace(/\.[^.]+$/, '.webp'),
      { type: 'image/webp' },
    )
    // Only use compressed if it's actually smaller
    return compressed.size < file.size ? compressed : file
  } catch {
    return file
  }
}

interface DigitalFile {
  path: string
  name: string
  size: number
  mime: string
  label: string
}
type Condition = 'new' | 'like_new' | 'good' | 'fair' | 'parts'

const CONDITIONS: { key: Condition; label: string; hint: string }[] = [
  { key: 'new',      label: 'Nuevo',        hint: 'Sin uso, en empaque original' },
  { key: 'like_new', label: 'Como nuevo',   hint: 'Casi sin uso, sin daños' },
  { key: 'good',     label: 'Buen estado',  hint: 'Uso normal, todo funciona' },
  { key: 'fair',     label: 'Aceptable',    hint: 'Señales de uso visibles' },
  { key: 'parts',    label: 'Para piezas',  hint: 'No funciona o incompleto' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPriceDisplay(raw: string): string {
  const num = parseFloat(raw.replace(/,/g, ''))
  if (isNaN(num) || num === 0) return ''
  return new Intl.NumberFormat('es-MX').format(num)
}

function parsePriceCents(raw: string): number | null {
  const num = parseFloat(raw.replace(/,/g, '').replace(/\s/g, ''))
  if (isNaN(num) || num <= 0) return null
  return Math.round(num * 100)
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressSteps({
  step,
  hasShopStep,
}: {
  step: 1 | 2 | 3
  hasShopStep: boolean
}) {
  const steps = hasShopStep
    ? ['Tu tienda', 'Tu anuncio']
    : ['Tu anuncio']

  // Map logical step to display index
  const displayIndex = hasShopStep ? step - 1 : step - 2

  if (step === 3) return null // success state has its own UI

  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => {
        const done = i < displayIndex
        const active = i === displayIndex
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`h-px flex-1 w-8 ${done ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? 'bg-[var(--color-accent)] text-white'
                    : active
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-border)] text-[var(--color-muted)]'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className={`text-sm font-medium ${
                  active ? 'text-[var(--color-text)]' : done ? 'text-[var(--color-muted)]' : 'text-[var(--color-muted)]'
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Photo upload zone ─────────────────────────────────────────────────────────

function PhotoUploader({
  photos,
  onChange,
}: {
  photos: UploadedPhoto[]
  onChange: (updater: React.SetStateAction<UploadedPhoto[]>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const MAX_PHOTOS = 10

  async function uploadFile(file: File, localId: string) {
    // Compress before upload: resize to ≤1920px, convert to WebP
    const compressed = await compressImage(file)
    const fd = new FormData()
    fd.append('file', compressed)
    try {
      const res = await fetch('/api/sell/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        onChange(prev =>
          prev.map(p =>
            p.localId === localId
              ? { ...p, status: 'error', errorMsg: data.error ?? 'Error al subir. Toca para reintentar.' }
              : p
          )
        )
        return
      }
      onChange(prev =>
        prev.map(p => (p.localId === localId ? { ...p, status: 'done', remoteUrl: data.url! } : p))
      )
    } catch {
      onChange(prev =>
        prev.map(p =>
          p.localId === localId
            ? { ...p, status: 'error', errorMsg: 'Sin conexión. Toca para reintentar.' }
            : p
        )
      )
    }
  }

  function addFiles(files: FileList | File[]) {
    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) return
    const toAdd = Array.from(files).slice(0, remaining)

    const newPhotos: UploadedPhoto[] = toAdd.map(file => ({
      localId: `${Date.now()}-${Math.random()}`,
      localUrl: URL.createObjectURL(file),
      remoteUrl: null,
      status: 'uploading' as const,
    }))

    onChange(prev => [...prev, ...newPhotos])

    // Start uploads
    newPhotos.forEach((photo, i) => {
      uploadFile(toAdd[i], photo.localId)
    })
  }

  function retryUpload(photo: UploadedPhoto, index: number) {
    // Can't retry without original file — mark for re-add
    // Best UX: remove the failed one so user can re-add it
    removePhoto(index)
  }

  function removePhoto(index: number) {
    onChange(prev => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].localUrl)
      next.splice(index, 1)
      return next
    })
  }

  const isAtMax = photos.length >= MAX_PHOTOS

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
        {photos.map((photo, index) => (
          <div key={photo.localId} className="relative aspect-square rounded overflow-hidden border border-[var(--color-border)] bg-[var(--color-background)]">
            <img
              src={photo.localUrl}
              alt=""
              className={`w-full h-full object-cover transition-opacity ${photo.status === 'uploading' ? 'opacity-50' : ''}`}
            />
            {/* Status overlay */}
            {photo.status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="text-white text-xl animate-spin">⟳</span>
              </div>
            )}
            {photo.status === 'error' && (
              <button
                type="button"
                onClick={() => retryUpload(photo, index)}
                title={photo.errorMsg}
                className="absolute inset-0 flex flex-col items-center justify-center bg-red-600/80 text-white text-xs p-1 text-center cursor-pointer"
              >
                <span className="text-lg mb-0.5">⚠</span>
                <span>Reintentar</span>
              </button>
            )}
            {/* Cover label */}
            {index === 0 && photo.status === 'done' && (
              <div className="absolute bottom-0 left-0 right-0 bg-[var(--color-accent)] text-white text-[10px] text-center py-0.5 font-medium">
                Portada
              </div>
            )}
            {/* Remove button */}
            {photo.status !== 'uploading' && (
              <button
                type="button"
                onClick={() => removePhoto(index)}
                className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center text-xs leading-none transition-colors"
                aria-label="Eliminar foto"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Drop zone / add more */}
        {!isAtMax && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              addFiles(e.dataTransfer.files)
            }}
            className={`aspect-square rounded border-2 border-dashed flex flex-col items-center justify-center text-[var(--color-muted)] transition-colors cursor-pointer ${
              dragging
                ? 'border-[var(--color-accent)] bg-green-50 text-[var(--color-accent)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
            } ${photos.length === 0 ? 'col-span-3 sm:col-span-4 aspect-auto min-h-[120px]' : ''}`}
          >
            <span className="text-2xl mb-1">{photos.length === 0 ? '📷' : '+'}</span>
            {photos.length === 0 ? (
              <>
                <span className="text-sm font-medium text-center px-4">Arrastra tus fotos aquí</span>
                <span className="text-xs mt-1 text-center px-4">o haz clic para seleccionar · máx. 8 MB por foto</span>
              </>
            ) : (
              <span className="text-xs">Agregar</span>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
      />

      <p className="text-xs text-[var(--color-muted)]">
        {photos.length > 0
          ? `${photos.length}/${MAX_PHOTOS} fotos · La primera foto es la portada`
          : 'Las fotos aumentan hasta 4× las probabilidades de venta'}
      </p>
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="text-red-600 text-xs mt-1 flex items-center gap-1"><span>⚠</span>{msg}</p>
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )
}

function CharCount({ current, max }: { current: number; max: number }) {
  const near = current > max * 0.85
  const over = current > max
  return (
    <span className={`text-xs ${over ? 'text-red-600 font-medium' : near ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
      {current}/{max}
    </span>
  )
}

// ── Step 1: Shop info ─────────────────────────────────────────────────────────

function StepShop({
  shopName, setShopName,
  shopSlug, setShopSlug, slugStatus, setSlugStatus,
  shopState, setShopState,
  shopCity, setShopCity,
  shopDescription, setShopDescription,
  errors,
  submitting,
  onNext,
}: {
  shopName: string; setShopName: (v: string) => void
  shopSlug: string; setShopSlug: (v: string) => void
  slugStatus: SlugStatus; setSlugStatus: (s: SlugStatus) => void
  shopState: string; setShopState: (v: string) => void
  shopCity: string; setShopCity: (v: string) => void
  shopDescription: string; setShopDescription: (v: string) => void
  errors: Record<string, string>
  submitting: boolean
  onNext: () => void
}) {
  const slugBlocked = slugStatus === 'taken' || slugStatus === 'invalid'
  return (
    <div className="space-y-5">
      {/* Shop name */}
      <div>
        <Label required>Nombre de tu tienda</Label>
        <input
          type="text"
          value={shopName}
          onChange={e => setShopName(e.target.value)}
          maxLength={80}
          placeholder="Ej: Automotriz García, Moda Oaxaca, Gadgets MX..."
          className={`w-full border rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition ${
            errors.shopName ? 'border-red-400' : 'border-[var(--color-border)]'
          }`}
          autoFocus
        />
        <div className="flex justify-between mt-1">
          <FieldError msg={errors.shopName} />
          <CharCount current={shopName.length} max={80} />
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          Este nombre aparecerá en tu perfil público y en cada anuncio.
        </p>
      </div>

      {/* Shop URL (slug) — auto-suggested from the name, editable */}
      <div>
        <SlugField
          value={shopSlug}
          onChange={setShopSlug}
          onStatusChange={setSlugStatus}
          label="URL de tu tienda"
        />
        <p className="text-xs text-[var(--color-muted)] mt-1">
          Tu enlace para compartir. Lo puedes cambiar después en ajustes.
        </p>
      </div>

      {/* Location */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label required>Estado / State</Label>
          <select
            value={shopState}
            onChange={e => { setShopState(e.target.value); setShopCity('') }}
            className={`w-full border rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition ${
              errors.shopState ? 'border-red-400' : 'border-[var(--color-border)]'
            }`}
          >
            <option value="">Selecciona un estado</option>
            {ESTADOS.map(e => (
              <option key={e.inegi_code} value={e.name}>{e.name}</option>
            ))}
          </select>
          <FieldError msg={errors.shopState} />
        </div>
        <div>
          <Label>Municipio / Municipality</Label>
          <select
            value={shopCity}
            onChange={e => setShopCity(e.target.value)}
            disabled={!shopState}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">{shopState ? 'Municipio (opcional)' : 'Primero elige estado'}</option>
            {(CITIES_BY_STATE[shopState] ?? []).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Description */}
      <div>
        <Label>Descripción de tu tienda <span className="text-[var(--color-muted)] font-normal">(opcional)</span></Label>
        <textarea
          value={shopDescription}
          onChange={e => setShopDescription(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="Cuéntale a tus compradores qué ofreces, tu especialidad, años de experiencia..."
          className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition resize-none"
        />
        <div className="flex justify-end mt-0.5">
          <CharCount current={shopDescription.length} max={200} />
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={submitting || slugBlocked}
        className="w-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-semibold py-3 rounded transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? 'Creando tu tienda…' : 'Continuar — Tu anuncio →'}
      </button>

      <p className="text-center text-xs text-[var(--color-muted)]">
        Creamos tu tienda al continuar — podrás personalizar el logo, colores y redes sociales más adelante.
      </p>
    </div>
  )
}

// ── Step 2: Listing form ──────────────────────────────────────────────────────

// ── REPUVE section (autos only) ───────────────────────────────────────────────

type RepuveStatus = 'sin_reporte' | 'con_reporte' | ''

function RepuveSection({
  status, setStatus,
  folio, setFolio,
}: {
  status: RepuveStatus; setStatus: (v: RepuveStatus) => void
  folio: string; setFolio: (v: string) => void
}) {
  const [pasteError, setPasteError] = useState('')

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      const cleaned = text.trim().replace(/\s+/g, '').toUpperCase().slice(0, 40)
      setFolio(cleaned)
      setPasteError('')
    } catch {
      setPasteError('Activa el permiso de portapapeles en tu navegador.')
      setTimeout(() => setPasteError(''), 3000)
    }
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5">🚗</span>
        <div>
          <h3 className="font-semibold text-sm text-amber-900">Verificación REPUVE</h3>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            El REPUVE es el Registro Público Vehicular del gobierno mexicano. Los compradores
            confían más en vehículos con reporte limpio.{' '}
            <span className="font-medium">Aumenta hasta 3× las probabilidades de vender.</span>
          </p>
        </div>
      </div>

      {/* How-to link */}
      <a
        href="https://www.repuve.gob.mx/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-xs font-semibold text-amber-800 hover:text-amber-900 no-underline bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-3 py-2 transition-colors w-full"
      >
        <span>📋</span>
        <span>Paso 1 — Consultar gratis en repuve.gob.mx →</span>
        <span className="ml-auto text-amber-600 text-[10px] uppercase tracking-wide">Abre en nueva pestaña</span>
      </a>

      <p className="text-xs text-amber-700">
        <strong>Paso 2</strong> — Descarga el PDF del resultado. El folio aparece en la parte superior del documento.
      </p>

      {/* Status radio */}
      <div>
        <p className="text-xs font-medium text-amber-900 mb-2">Paso 3 — ¿Qué dice el reporte?</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'sin_reporte', label: '✓ Sin reporte', hint: 'Vehículo limpio' },
            { key: 'con_reporte', label: '⚠ Con reporte',  hint: 'Robo u otro reporte' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setStatus(opt.key)}
              className={`border rounded-lg py-2.5 px-3 text-left transition-all ${
                status === opt.key
                  ? opt.key === 'sin_reporte'
                    ? 'border-green-500 bg-green-50'
                    : 'border-red-400 bg-red-50'
                  : 'border-amber-300 bg-white hover:border-amber-500'
              }`}
            >
              <p className={`text-sm font-semibold ${
                status === opt.key
                  ? opt.key === 'sin_reporte' ? 'text-green-700' : 'text-red-600'
                  : 'text-amber-800'
              }`}>{opt.label}</p>
              <p className="text-xs text-amber-600 mt-0.5">{opt.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Folio input — only when status selected */}
      {status && (
        <div>
          <p className="text-xs font-medium text-amber-900 mb-1.5">
            Paso 4 — Folio del reporte <span className="font-normal text-amber-700">(aparece en el PDF)</span>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={folio}
              onChange={e => setFolio(e.target.value.toUpperCase().replace(/\s+/g, '').slice(0, 40))}
              placeholder="Ej: MX202600001234"
              className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent font-mono uppercase"
            />
            <button
              type="button"
              onClick={pasteFromClipboard}
              className="flex items-center gap-1.5 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-800 bg-white hover:bg-amber-100 hover:border-amber-400 transition-colors whitespace-nowrap"
              title="Pegar desde portapapeles"
            >
              📋 Pegar
            </button>
          </div>
          {pasteError && <p className="text-red-500 text-xs mt-1">{pasteError}</p>}
        </div>
      )}

      {/* Skip option */}
      {!status && (
        <p className="text-xs text-amber-600 text-center">
          Puedes agregar la verificación después desde tu panel de gestión.
        </p>
      )}
    </div>
  )
}

function StepListing({
  photos, setPhotos,
  title, setTitle,
  category, setCategory,
  listingType, setListingType,
  condition, setCondition,
  quantity, setQuantity,
  priceRaw, setPriceRaw,
  priceOnRequest, setPriceOnRequest,
  description, setDescription,
  listingState, setListingState,
  listingCity, setListingCity,
  digitalFile, setDigitalFile,
  repuveStatus, setRepuveStatus,
  repuveFolio, setRepuveFolio,
  subTiers, setSubTiers,
  attrs, setAttr,
  errors,
  submitting,
  submitError,
  onBack,
  onSubmit,
  hasShopStep,
}: {
  photos: UploadedPhoto[]; setPhotos: (fn: React.SetStateAction<UploadedPhoto[]>) => void
  title: string; setTitle: (v: string) => void
  category: string; setCategory: (v: string) => void
  listingType: ListingType; setListingType: (v: ListingType) => void
  condition: Condition; setCondition: (v: Condition) => void
  quantity: string; setQuantity: (v: string) => void
  priceRaw: string; setPriceRaw: (v: string) => void
  priceOnRequest: boolean; setPriceOnRequest: (v: boolean) => void
  description: string; setDescription: (v: string) => void
  listingState: string; setListingState: (v: string) => void
  listingCity: string; setListingCity: (v: string) => void
  digitalFile: DigitalFile | null; setDigitalFile: (f: DigitalFile | null) => void
  repuveStatus: RepuveStatus; setRepuveStatus: (v: RepuveStatus) => void
  repuveFolio: string; setRepuveFolio: (v: string) => void
  subTiers: { id: string; label: string; price_raw: string; interval: 'month' | 'year'; features_raw: string; is_highlighted: boolean }[]
  setSubTiers: React.Dispatch<React.SetStateAction<{ id: string; label: string; price_raw: string; interval: 'month' | 'year'; features_raw: string; is_highlighted: boolean }[]>>
  attrs: Attrs; setAttr: (k: string, v: string) => void
  errors: Record<string, string>
  submitting: boolean
  submitError: string | null
  onBack: () => void
  onSubmit: () => void
  hasShopStep: boolean
}) {
  const [digitalUploading, setDigitalUploading] = useState(false)
  const digitalInputRef = useRef<HTMLInputElement>(null)
  const pendingUploads = photos.filter(p => p.status === 'uploading').length
  const failedUploads = photos.filter(p => p.status === 'error').length
  const canSubmit = !submitting && pendingUploads === 0 && failedUploads === 0 && !digitalUploading

  // Submit button copy depending on state
  let btnLabel = '✓ Publicar anuncio'
  if (submitting) btnLabel = 'Publicando…'
  else if (pendingUploads > 0) btnLabel = `Subiendo ${pendingUploads} foto${pendingUploads > 1 ? 's' : ''}…`
  else if (failedUploads > 0) btnLabel = `${failedUploads} foto${failedUploads > 1 ? 's' : ''} con error — corrige antes de publicar`

  return (
    <div className="space-y-6">
      {/* Global error banner */}
      {submitError && (
        <Banner variant="danger" title="No se pudo publicar">
          {submitError}
        </Banner>
      )}

      {/* Photos */}
      <div>
        <Label>Fotos</Label>
        <PhotoUploader
          photos={photos}
          onChange={useCallback((fn) => setPhotos(typeof fn === 'function' ? fn : () => fn), [setPhotos])}
        />
        {failedUploads > 0 && (
          <p className="text-red-600 text-xs mt-1.5 flex items-center gap-1">
            <span>⚠</span> {failedUploads} foto{failedUploads > 1 ? 's' : ''} no se pudo subir — toca la foto roja para eliminarla y agrega una nueva.
          </p>
        )}
      </div>

      {/* Title */}
      <div>
        <Label required>Título del anuncio</Label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Ej: iPhone 14 Pro 256 GB negro espacial, Toyota Corolla 2021, Clases de guitarra..."
          className={`w-full border rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition ${
            errors.title ? 'border-red-400' : 'border-[var(--color-border)]'
          }`}
        />
        <div className="flex justify-between mt-1">
          <FieldError msg={errors.title} />
          <CharCount current={title.length} max={100} />
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1">Sé específico: marca, modelo, características importantes. Mejora la visibilidad en búsquedas.</p>
      </div>

      {/* Category */}
      <div>
        <Label required>Categoría</Label>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setCategory(cat.key)}
              className={`border rounded py-2 px-1 text-xs text-center flex flex-col items-center gap-1 transition-all ${
                category === cat.key
                  ? 'border-[var(--color-accent)] bg-green-50 text-[var(--color-accent)] font-semibold'
                  : 'border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
              }`}
            >
              <i className={`iconoir-${cat.icon} leading-none`} style={{ fontSize: 18 }} aria-hidden />
              <span className="leading-tight">{cat.label}</span>
            </button>
          ))}
        </div>
        <FieldError msg={errors.category} />
      </div>

      {/* Listing type */}
      <div>
        <Label>Tipo de anuncio</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {([
            { key: 'product',      label: '📦 Producto',     hint: 'Artículo físico' },
            { key: 'service',      label: '🔧 Servicio',     hint: 'Clases, reparaciones…' },
            { key: 'rental',       label: '🔑 Renta',        hint: 'Alquiler por tiempo' },
            { key: 'digital',      label: '💻 Digital',      hint: 'PDF, ZIP, MP3, video, plantillas…' },
            { key: 'subscription', label: '🔔 Suscripción',  hint: 'Contenido mensual / acceso recurrente' },
          ] as const).map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setListingType(t.key)}
              title={t.hint}
              className={`border rounded py-2.5 text-sm transition-all ${
                listingType === t.key
                  ? 'border-[var(--color-accent)] bg-green-50 text-[var(--color-accent)] font-semibold'
                  : 'border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {listingType === 'digital' && (
          <p className="text-xs text-[var(--color-muted)] mt-1.5">
            💡 Entrega automática al comprar — el comprador recibe su archivo al instante.
          </p>
        )}
        {listingType === 'subscription' && (
          <p className="text-xs text-[var(--color-muted)] mt-1.5">
            🔔 Los suscriptores pagan mensual o anualmente y acceden a tu biblioteca de contenido exclusivo.
          </p>
        )}
      </div>

      {/* Multi-tier subscription builder */}
      {listingType === 'subscription' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--color-text)]">⚙️ Planes de suscripción</p>
            {subTiers.length < 3 && (
              <button
                type="button"
                onClick={() => setSubTiers(prev => [...prev, { id: Math.random().toString(36).slice(2), label: '', price_raw: '', interval: 'month', features_raw: '', is_highlighted: false }])}
                className="text-xs text-[var(--color-accent)] border border-[var(--color-accent)] px-2.5 py-1 rounded hover:bg-green-50 transition-colors"
              >
                + Agregar plan
              </button>
            )}
          </div>
          <FieldError msg={errors.subscription_tiers} />

          {subTiers.map((tier, idx) => (
            <div key={tier.id} className={`border rounded-xl p-4 space-y-3 ${tier.is_highlighted ? 'border-[var(--color-accent)] bg-green-50/30' : 'border-[var(--color-border)] bg-[var(--color-background)]'}`}>
              {/* Header */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Plan {idx + 1}</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tier.is_highlighted}
                      onChange={e => setSubTiers(prev => prev.map(t => t.id === tier.id ? { ...t, is_highlighted: e.target.checked } : { ...t, is_highlighted: false }))}
                      className="w-3.5 h-3.5 accent-[var(--color-accent)]"
                    />
                    <span className="text-xs text-[var(--color-muted)]">Destacado</span>
                  </label>
                  {subTiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSubTiers(prev => prev.filter(t => t.id !== tier.id))}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      ✕ Quitar
                    </button>
                  )}
                </div>
              </div>

              {/* Label + price row */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text)] mb-1">Nombre del plan <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={tier.label}
                    onChange={e => setSubTiers(prev => prev.map(t => t.id === tier.id ? { ...t, label: e.target.value } : t))}
                    placeholder="Ej: Básico, Pro, Premium"
                    maxLength={40}
                    className="w-full border border-[var(--color-border)] rounded px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text)] mb-1">Precio <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tier.price_raw}
                    onChange={e => setSubTiers(prev => prev.map(t => t.id === tier.id ? { ...t, price_raw: e.target.value } : t))}
                    placeholder="199"
                    className="w-full border border-[var(--color-border)] rounded px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                  />
                </div>
              </div>

              {/* Interval */}
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: 'month', label: '📅 Mensual' },
                  { key: 'year',  label: '🗓️ Anual' },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSubTiers(prev => prev.map(t => t.id === tier.id ? { ...t, interval: opt.key } : t))}
                    className={`border rounded py-2 text-xs transition-all ${
                      tier.interval === opt.key
                        ? 'border-[var(--color-accent)] bg-green-50 text-[var(--color-accent)] font-semibold'
                        : 'border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Features */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text)] mb-1">¿Qué incluye? <span className="text-[var(--color-muted)] font-normal">(una por línea)</span></label>
                <textarea
                  value={tier.features_raw}
                  onChange={e => setSubTiers(prev => prev.map(t => t.id === tier.id ? { ...t, features_raw: e.target.value } : t))}
                  rows={3}
                  placeholder={'Recetas semanales exclusivas\nClases en vivo mensuales\nDescuentos de miembro'}
                  className="w-full border border-[var(--color-border)] rounded px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent resize-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Digital file uploader */}
      {listingType === 'digital' && (
        <div>
          <Label required>Archivo digital</Label>
          {digitalFile ? (
            <div className="flex items-center gap-3 p-3 border border-green-300 bg-green-50 rounded-lg">
              <span className="text-2xl">📄</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{digitalFile.name}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {digitalFile.label} · {(digitalFile.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
              <button type="button" onClick={() => setDigitalFile(null)}
                className="text-xs text-red-600 hover:underline flex-shrink-0">
                Cambiar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => digitalInputRef.current?.click()}
              disabled={digitalUploading}
              className={`w-full border-2 border-dashed border-[var(--color-border)] rounded-lg py-8 flex flex-col items-center gap-2 transition-colors ${
                digitalUploading ? 'opacity-60 cursor-not-allowed' : 'hover:border-[var(--color-accent)] cursor-pointer'
              }`}
            >
              <span className="text-3xl">{digitalUploading ? '⏳' : '📁'}</span>
              <span className="text-sm font-medium">
                {digitalUploading ? 'Subiendo archivo…' : 'Haz clic para seleccionar el archivo'}
              </span>
              <span className="text-xs text-[var(--color-muted)]">
                PDF, ZIP, MP3, MP4, EPUB y más · máx. 100 MB
              </span>
            </button>
          )}
          <input
            ref={digitalInputRef}
            type="file"
            className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0]
              if (!file) return
              e.target.value = ''
              setDigitalUploading(true)
              try {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch('/api/sell/digital-upload', { method: 'POST', body: fd })
                const data = await res.json() as DigitalFile & { error?: string }
                if (!res.ok || data.error) {
                  // surfaced via errors.digitalFile
                  setDigitalFile(null)
                } else {
                  setDigitalFile({ path: data.path, name: data.name, size: data.size, mime: data.mime, label: data.label })
                }
              } catch {
                // no-op — user retries
              } finally {
                setDigitalUploading(false)
              }
            }}
          />
          <FieldError msg={errors.digitalFile} />
        </div>
      )}

      {/* Category-specific attributes (brand, size, year, etc.) */}
      {category && (
        <AttrsSection
          category={category}
          listingType={listingType}
          attrs={attrs}
          setAttr={setAttr}
        />
      )}

      {/* Condition (only for products) */}
      {listingType === 'product' && (
        <div>
          <Label>Estado del artículo</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CONDITIONS.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCondition(c.key)}
                title={c.hint}
                className={`border rounded py-2 px-3 text-left transition-all ${
                  condition === c.key
                    ? 'border-[var(--color-accent)] bg-green-50'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                }`}
              >
                <p className={`text-sm font-medium ${condition === c.key ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                  {c.label}
                </p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">{c.hint}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cantidad (stock) — only for physical products. Default 1 (artículo único). */}
      {listingType === 'product' && (
        <div>
          <Label>Cantidad disponible</Label>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => setQuantity(String(Math.max(1, parseInt(quantity) || 1)))}
            className="w-32 border rounded px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition"
          />
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Para artículos únicos deja 1. Al venderse, el anuncio se marca como agotado automáticamente.
          </p>
        </div>
      )}

      {/* Price — hidden for subscription (price is per-tier in the builder above) */}
      <div className={listingType === 'subscription' ? 'hidden' : ''}>
        <Label required={!priceOnRequest}>Precio</Label>
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-[var(--color-accent)] focus-within:border-transparent transition">
              <span className="px-3 text-[var(--color-muted)] text-sm border-r border-[var(--color-border)] py-2.5 bg-[var(--color-background)] shrink-0">
                MXN $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={priceRaw}
                disabled={priceOnRequest}
                onChange={e => {
                  // Allow digits, commas, one decimal point
                  const v = e.target.value.replace(/[^0-9.,]/g, '')
                  setPriceRaw(v)
                }}
                placeholder={priceOnRequest ? 'Precio a consultar' : '0.00'}
                className={`flex-1 px-3 py-2.5 text-sm bg-white focus:outline-none disabled:bg-[var(--color-background)] disabled:text-[var(--color-muted)] ${
                  errors.price ? 'border-red-400' : ''
                }`}
              />
            </div>
            <FieldError msg={errors.price} />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={priceOnRequest}
            onChange={e => {
              setPriceOnRequest(e.target.checked)
              if (e.target.checked) setPriceRaw('')
            }}
            className="w-4 h-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm text-[var(--color-text)]">Precio a consultar</span>
          <span className="text-xs text-[var(--color-muted)]">(el comprador te contacta)</span>
        </label>
      </div>

      {/* Description */}
      <div>
        <Label>Descripción <span className="text-[var(--color-muted)] font-normal">(opcional pero recomendada)</span></Label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder={
            listingType === 'product'
              ? 'Describe el estado, medidas, accesorios incluidos, motivo de venta...'
              : listingType === 'service'
              ? 'Describe tu experiencia, metodología, qué incluye el servicio, horarios...'
              : 'Describe el inmueble/artículo, condiciones de renta, qué incluye...'
          }
          className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition resize-none"
        />
        <div className="flex justify-between mt-0.5">
          <p className="text-xs text-[var(--color-muted)]">Los anuncios con descripción reciben un 70% más de contactos.</p>
          <CharCount current={description.length} max={2000} />
        </div>
      </div>

      {/* Location */}
      <div>
        <Label>Ubicación del anuncio / Listing location</Label>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <select
              value={listingState}
              onChange={e => { setListingState(e.target.value); setListingCity('') }}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition"
            >
              <option value="">Estado / State (opcional)</option>
              {ESTADOS.map(e => (
                <option key={e.inegi_code} value={e.name}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={listingCity}
              onChange={e => setListingCity(e.target.value)}
              disabled={!listingState}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{listingState ? 'Municipio / Municipality (opcional)' : 'Primero elige estado'}</option>
              {(CITIES_BY_STATE[listingState] ?? []).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1">Ayuda a compradores cercanos a encontrarte.</p>
      </div>

      {/* REPUVE — only for autos */}
      {category === 'autos' && (
        <RepuveSection
          status={repuveStatus}
          setStatus={setRepuveStatus}
          folio={repuveFolio}
          setFolio={setRepuveFolio}
        />
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {hasShopStep && (
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] py-3 rounded text-sm font-medium hover:bg-[var(--color-background)] transition-colors disabled:opacity-50"
          >
            ← Atrás
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={`flex-1 py-3 rounded text-sm font-semibold transition-all ${
            canSubmit
              ? 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white'
              : 'bg-[var(--color-border)] text-[var(--color-muted)] cursor-not-allowed'
          }`}
        >
          {btnLabel}
        </button>
      </div>

      <p className="text-xs text-[var(--color-muted)] text-center">
        Tu anuncio se publicará de inmediato y será visible para todos los compradores.
      </p>

      {/* Escape hatch — shop is already created, so the dashboard is reachable now */}
      <p className="text-xs text-center">
        <a href="/shop/manage" className="text-[var(--color-muted)] hover:text-[var(--color-accent)] no-underline">
          Terminar después — ir a mi tienda →
        </a>
      </p>
    </div>
  )
}

// ── Step 3: Success ───────────────────────────────────────────────────────────

function StepSuccess({
  result,
  title,
  photos,
  priceRaw,
  priceOnRequest,
  onPublishAnother,
}: {
  result: { shopSlug: string; listingId: string }
  title: string
  photos: UploadedPhoto[]
  priceRaw: string
  priceOnRequest: boolean
  onPublishAnother: () => void
}) {
  const coverPhoto = photos.find(p => p.status === 'done')

  return (
    <div className="text-center">
      {/* Success icon */}
      <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-5">
        <span className="text-3xl">✅</span>
      </div>

      <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">¡Tu anuncio está publicado!</h2>
      <p className="text-[var(--color-muted)] text-sm mb-6">
        Ya está visible para compradores en todo México.
      </p>

      {/* Listing preview card */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden mx-auto max-w-xs mb-6 text-left">
        {coverPhoto ? (
          <img src={coverPhoto.localUrl} alt={title} className="w-full h-40 object-cover" />
        ) : (
          <div className="w-full h-40 bg-[var(--color-background)] flex items-center justify-center text-4xl">📦</div>
        )}
        <div className="p-3">
          <p className="font-semibold text-sm text-[var(--color-text)] line-clamp-2">{title}</p>
          <p className="text-[var(--color-accent)] font-bold mt-0.5">
            {priceOnRequest ? 'Precio a consultar' : priceRaw ? `$${formatPriceDisplay(priceRaw)} MXN` : 'Precio a consultar'}
          </p>
        </div>
      </div>

      {/* CTA buttons */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <a
          href={`/l/${result.listingId}`}
          className="flex-1 bg-[var(--color-accent)] !text-white text-center font-semibold py-3 rounded no-underline hover:bg-[var(--color-accent-hover)] transition-colors text-sm"
        >
          Ver mi anuncio →
        </a>
        <a
          href={`/s/${result.shopSlug}`}
          className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] text-center font-medium py-3 rounded no-underline hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors text-sm"
        >
          Ver mi tienda
        </a>
      </div>

      {/* Divider */}
      <div className="border-t border-[var(--color-border)] pt-5 mb-5">
        <p className="text-sm font-semibold text-[var(--color-text)] mb-3">¿Tienes más cosas para vender?</p>
        <button
          type="button"
          onClick={onPublishAnother}
          className="w-full border border-[var(--color-accent)] text-[var(--color-accent)] py-2.5 rounded text-sm font-medium hover:bg-green-50 transition-colors"
        >
          + Publicar otro anuncio
        </button>
      </div>

      {/* Tip */}
      <div className="bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg p-4 text-left">
        <p className="text-xs font-semibold text-[var(--color-text)] mb-1">💡 Siguiente paso</p>
        <p className="text-xs text-[var(--color-muted)] mb-2">
          Personaliza tu tienda con tu logo, colores y redes sociales para generar más confianza en los compradores.
        </p>
        <a
          href={`/shop/manage`}
          className="text-xs text-[var(--color-accent)] font-medium no-underline hover:underline"
        >
          Ir a gestionar mi tienda →
        </a>
      </div>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function SellWizard({
  existingShop,
}: {
  existingShop: ExistingShop | null
}) {
  const hasShopStep = existingShop === null
  const initialStep = hasShopStep ? 1 : 2

  // Navigation
  const [step, setStep] = useState<1 | 2 | 3>(initialStep as 1 | 2 | 3)

  // Step 1 — shop
  const [shopName, setShopName] = useState('')
  const [shopSlug, setShopSlug] = useState('')
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle')
  const slugTouched = useRef(false)
  const [shopState, setShopState] = useState('')
  const [shopCity, setShopCity] = useState('')
  const [shopDescription, setShopDescription] = useState('')
  const [shopErrors, setShopErrors] = useState<Record<string, string>>({})
  const [creatingShop, setCreatingShop] = useState(false)

  // Auto-suggest the slug from the shop name until the seller edits it directly.
  useEffect(() => {
    if (!slugTouched.current) setShopSlug(slugify(shopName))
  }, [shopName])
  function handleSlugChange(v: string) { slugTouched.current = true; setShopSlug(v) }

  // Step 2 — listing
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [listingType, setListingType] = useState<ListingType>('product')
  const [condition, setCondition] = useState<Condition>('good')
  const [quantity, setQuantity] = useState('1')
  const [priceRaw, setPriceRaw] = useState('')
  const [priceOnRequest, setPriceOnRequest] = useState(false)
  const [description, setDescription] = useState('')
  const [listingState, setListingState] = useState(existingShop?.location?.split(', ').pop() ?? '')
  const [listingCity, setListingCity] = useState('')
  const [digitalFile, setDigitalFile] = useState<DigitalFile | null>(null)
  const [repuveStatus, setRepuveStatus] = useState<RepuveStatus>('')
  const [repuveFolio, setRepuveFolio] = useState('')
  // Category-specific structured attributes (brand, size, year, km…)
  const [attrs, setAttrs] = useState<Attrs>({})
  function setAttr(k: string, v: string) {
    setAttrs(prev => ({ ...prev, [k]: v }))
  }
  // Multi-tier subscription state (Phase B)
  interface SubTier {
    id: string
    label: string
    price_raw: string
    interval: 'month' | 'year'
    features_raw: string   // newline-separated list
    is_highlighted: boolean
  }
  const makeDefaultTier = (): SubTier => ({
    id: Math.random().toString(36).slice(2),
    label: '',
    price_raw: '',
    interval: 'month',
    features_raw: '',
    is_highlighted: false,
  })
  const [subTiers, setSubTiers] = useState<SubTier[]>([makeDefaultTier()])
  const [listingErrors, setListingErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Step 3 — result
  const [result, setResult] = useState<{ shopSlug: string; listingId: string } | null>(null)

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleShopNext() {
    const errs: Record<string, string> = {}
    if (shopName.trim().length < 2) errs.shopName = 'El nombre debe tener al menos 2 caracteres.'
    if (shopName.trim().length > 80) errs.shopName = 'El nombre no puede superar los 80 caracteres.'
    if (!shopState) errs.shopState = 'Selecciona tu estado.'
    setShopErrors(errs)
    if (Object.keys(errs).length > 0) return

    // Persist the shop now so it survives an abandoned listing — decouples shop
    // creation from listing creation. Idempotent on the server.
    setCreatingShop(true)
    try {
      const res = await fetch('/api/sell/shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: shopName.trim(),
          slug: shopSlug.trim() || undefined,
          state: shopState,
          city: shopCity.trim() || undefined,
          description: shopDescription.trim() || undefined,
        }),
      })
      const data = await res.json() as { shopSlug?: string; error?: string; field?: string }
      if (!res.ok || !data.shopSlug) {
        setShopErrors({ shopName: data.error ?? 'No se pudo crear la tienda. Inténtalo de nuevo.' })
        return
      }
      setStep(2)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setShopErrors({ shopName: 'Sin conexión. Inténtalo de nuevo.' })
    } finally {
      setCreatingShop(false)
    }
  }

  function handleBack() {
    setStep(1)
    setSubmitError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit() {
    // Validate listing fields
    const errs: Record<string, string> = {}
    if (title.trim().length < 5) errs.title = 'El título debe tener al menos 5 caracteres.'
    if (title.trim().length > 100) errs.title = 'El título no puede superar los 100 caracteres.'
    if (!category) errs.category = 'Selecciona una categoría para tu anuncio.'
    if (listingType !== 'subscription' && !priceOnRequest && !priceRaw.trim()) {
      errs.price = 'Ingresa un precio o marca "Precio a consultar".'
    }
    if (listingType !== 'subscription' && !priceOnRequest && priceRaw) {
      const cents = parsePriceCents(priceRaw)
      if (!cents || cents <= 0) errs.price = 'El precio debe ser mayor a $0.'
    }
    if (listingType === 'digital' && !digitalFile) {
      errs.digitalFile = 'Sube el archivo que los compradores recibirán al pagar.'
    }
    if (listingType === 'subscription') {
      for (const t of subTiers) {
        if (!t.label.trim()) { errs.subscription_tiers = 'Cada plan necesita un nombre.'; break }
        if (!parsePriceCents(t.price_raw)) { errs.subscription_tiers = `El plan "${t.label || 'sin nombre'}" necesita un precio válido.`; break }
      }
    }
    setListingErrors(errs)
    if (Object.keys(errs).length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const priceCents = priceOnRequest ? null : parsePriceCents(priceRaw)
      const readyPhotos = photos.filter(p => p.status === 'done' && p.remoteUrl)
        .map(p => ({ url: p.remoteUrl!, alt: title.trim() }))

      const payload = {
        createShop: hasShopStep
          ? { name: shopName.trim(), slug: shopSlug.trim() || undefined, state: shopState, city: shopCity.trim() || undefined, description: shopDescription.trim() || undefined }
          : undefined,
        listing: {
          title: title.trim(),
          description: description.trim() || undefined,
          price_cents: priceCents,
          currency: 'MXN',
          condition: listingType === 'product' ? condition : undefined,
          quantity: listingType === 'product' ? Math.max(1, parseInt(quantity) || 1) : undefined,
          listing_type: listingType,
          category,
          state: listingState || undefined,
          estado_code: listingState ? ESTADO_INEGI_BY_NAME[listingState] : undefined,
          municipio: listingCity.trim() || undefined,
          // Non-empty attrs only (strip blank strings)
          attrs: Object.fromEntries(
            Object.entries(attrs).filter(([, v]) => v !== '' && v !== null && v !== undefined)
          ),
          images: readyPhotos,
          digital_file: digitalFile ?? undefined,
          repuve: repuveStatus ? { status: repuveStatus, folio: repuveFolio || undefined } : undefined,
          subscription_tiers: listingType === 'subscription' ? subTiers.map(t => ({
            id: t.id,
            label: t.label.trim(),
            price_cents: parsePriceCents(t.price_raw)!,
            interval: t.interval,
            features: t.features_raw.split('\n').map(s => s.trim()).filter(Boolean),
            is_highlighted: t.is_highlighted,
          })) : undefined,
        },
      }

      const res = await fetch('/api/sell/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json() as { shopSlug?: string; listingId?: string; error?: string; field?: string }

      if (!res.ok || !data.shopSlug || !data.listingId) {
        if (data.field === 'title') setListingErrors(prev => ({ ...prev, title: data.error! }))
        else if (data.field === 'category') setListingErrors(prev => ({ ...prev, category: data.error! }))
        else if (data.field === 'shopName') { setShopErrors(prev => ({ ...prev, shopName: data.error! })); setStep(1) }
        else setSubmitError(data.error ?? 'Algo salió mal. Inténtalo de nuevo.')
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      setResult({ shopSlug: data.shopSlug, listingId: data.listingId })
      setStep(3)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setSubmitError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  function handlePublishAnother() {
    // Reset listing fields, keep shop fields
    setPhotos([])
    setTitle('')
    setCategory('')
    setListingType('product')
    setCondition('good')
    setAttrs({})
    setSubTiers([{ id: Math.random().toString(36).slice(2), label: '', price_raw: '', interval: 'month', features_raw: '', is_highlighted: false }])
    setPriceRaw('')
    setPriceOnRequest(false)
    setDescription('')
    setListingErrors({})
    setSubmitError(null)
    setResult(null)
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      {step !== 3 && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            {step === 1 ? 'Crea tu tienda' : 'Publica tu anuncio'}
          </h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">
            {step === 1
              ? 'Es gratis y tarda menos de 2 minutos.'
              : existingShop
              ? `Publicando en: ${existingShop.name}`
              : 'Completa los datos de tu anuncio.'}
          </p>
        </div>
      )}

      {/* Progress */}
      <ProgressSteps step={step} hasShopStep={hasShopStep} />

      {/* Card */}
      <div className="bg-white border border-[var(--color-border)] rounded-xl p-5 sm:p-7">
        {step === 1 && (
          <StepShop
            shopName={shopName} setShopName={setShopName}
            shopSlug={shopSlug} setShopSlug={handleSlugChange}
            slugStatus={slugStatus} setSlugStatus={setSlugStatus}
            shopState={shopState} setShopState={setShopState}
            shopCity={shopCity} setShopCity={setShopCity}
            shopDescription={shopDescription} setShopDescription={setShopDescription}
            errors={shopErrors}
            submitting={creatingShop}
            onNext={handleShopNext}
          />
        )}
        {step === 2 && (
          <StepListing
            photos={photos} setPhotos={setPhotos}
            title={title} setTitle={setTitle}
            category={category} setCategory={setCategory}
            listingType={listingType} setListingType={setListingType}
            condition={condition} setCondition={setCondition}
            quantity={quantity} setQuantity={setQuantity}
            priceRaw={priceRaw} setPriceRaw={setPriceRaw}
            priceOnRequest={priceOnRequest} setPriceOnRequest={setPriceOnRequest}
            description={description} setDescription={setDescription}
            listingState={listingState} setListingState={setListingState}
            listingCity={listingCity} setListingCity={setListingCity}
            digitalFile={digitalFile} setDigitalFile={setDigitalFile}
            repuveStatus={repuveStatus} setRepuveStatus={setRepuveStatus}
            repuveFolio={repuveFolio} setRepuveFolio={setRepuveFolio}
            subTiers={subTiers} setSubTiers={setSubTiers}
            attrs={attrs} setAttr={setAttr}
            errors={listingErrors}
            submitting={submitting}
            submitError={submitError}
            onBack={handleBack}
            onSubmit={handleSubmit}
            hasShopStep={hasShopStep}
          />
        )}
        {step === 3 && result && (
          <StepSuccess
            result={result}
            title={title}
            photos={photos}
            priceRaw={priceRaw}
            priceOnRequest={priceOnRequest}
            onPublishAnother={handlePublishAnother}
          />
        )}
      </div>

      {/* Trust signals */}
      {step !== 3 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-[var(--color-muted)]">
          <span>✓ Sin comisiones</span>
          <span>✓ Publicación instantánea</span>
          <span>✓ 100% gratis</span>
        </div>
      )}
    </div>
  )
}
