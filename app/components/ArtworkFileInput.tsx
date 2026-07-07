'use client'

import { useRef, useState } from 'react'
import { checkArtworkResolution, type ArtworkFormat } from '@/lib/personalization'

const ACCEPT_FOR_FORMAT: Record<ArtworkFormat, string> = {
  png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf', ai: '.ai', svg: 'image/svg+xml,.svg',
}

/**
 * Upload widget for a `file` personalization field — owns its own
 * upload/progress/error/preview state and reports back through the same
 * `onChange(id, url)` contract every other `PersonalizationFields` case
 * uses, so the parent (and `PersonalizationFields` itself) stays
 * network-unaware. Rendered from `PersonalizationFields.tsx`'s `'file'` case.
 *
 * `physicalCm` (only ever passed from the configurator, which knows the
 * selected size dimension) drives the Story 3.3 low-res preflight — absent
 * a physical size (e.g. `PersonalizationBuyBox`'s flat-price context), the
 * preflight is naturally a no-op.
 */
export default function ArtworkFileInput({
  fieldId,
  listingId,
  allowedFormats,
  maxSizeMb,
  value,
  onChange,
  physicalCm,
}: {
  fieldId: string
  listingId: string
  allowedFormats: ArtworkFormat[]
  maxSizeMb: number
  value: string
  onChange: (id: string, value: string) => void
  physicalCm?: number | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const accept = allowedFormats.map(f => ACCEPT_FOR_FORMAT[f]).join(',')
  const isImagePreview = /\.(png|jpe?g|svg)$/i.test(value)

  async function handleFile(file: File) {
    setError(null)
    setWarning(null)

    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`El archivo es demasiado grande. El máximo es ${maxSizeMb} MB.`)
      return
    }

    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('listingId', listingId)
      body.append('fieldId', fieldId)
      const res = await fetch('/api/artwork/upload', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'No se pudo subir el archivo.')
        return
      }
      onChange(fieldId, data.url)
      setFileName(file.name)

      // Low-res preflight — raster formats only, and only when we know the
      // physical print size (configurator context).
      if (physicalCm && /^image\/(png|jpeg)$/.test(file.type)) {
        const dims = await readImageDimensions(file).catch(() => null)
        if (dims) {
          const check = checkArtworkResolution({ pixelWidth: dims.width, pixelHeight: dims.height, physicalCm })
          if (check.warn) setWarning(check.message ?? null)
        }
      }
    } catch {
      setError('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setUploading(false)
    }
  }

  function remove() {
    onChange(fieldId, '')
    setFileName(null)
    setWarning(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
        style={{ display: 'none' }}
        id={`artwork_${fieldId}`}
      />

      {!value ? (
        <label
          htmlFor={`artwork_${fieldId}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '14px 12px', borderRadius: 'var(--r-md)', border: '1.5px dashed var(--border)',
            background: 'var(--bg)', color: 'var(--fg-muted)', fontSize: 13, cursor: 'pointer',
          }}
        >
          {uploading ? (
            <><span className="animate-spin inline-block">⟳</span> Subiendo…</>
          ) : (
            <>📎 Subir archivo ({allowedFormats.join(', ').toUpperCase()} · máx. {maxSizeMb} MB)</>
          )}
        </label>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          {isImagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Vista previa del arte" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <span style={{ fontSize: 22 }}>📄</span>
          )}
          <span style={{ flex: 1, fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName ?? 'Archivo subido'}
          </span>
          <button type="button" onClick={remove} style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Quitar
          </button>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{error}</p>}
      {warning && <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>⚠️ {warning}</p>}
    </div>
  )
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      reject(new Error('image load failed'))
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}
