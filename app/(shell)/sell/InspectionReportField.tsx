'use client'

import { useRef, useState } from 'react'

/**
 * Autos inspection-report capture (cars-vertical S2.1) — a bespoke field
 * (not a schema-driven AttrInput; no AttrFieldType expresses "upload a PDF OR
 * paste a URL"). Either origin writes the same `attrs.inspection_report_url`
 * string. Self-contained local upload/error state, mirroring the digital-file
 * dropzone block in SellWizard.tsx stylistically.
 */
export function InspectionReportField({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/sell/inspection-upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error ?? 'No se pudo subir el reporte. Inténtalo de nuevo.')
      } else {
        onChange(data.url)
      }
    } catch {
      setError('No se pudo subir el reporte. Inténtalo de nuevo.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2 border border-cyan-200 bg-cyan-50/60 rounded-xl p-4">
      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">
        Reporte de inspección (opcional)
      </p>

      {value ? (
        <div className="flex items-center gap-3 p-3 border border-green-300 bg-green-50 rounded-lg">
          <i className="iconoir-page text-2xl" aria-hidden />
          <div className="flex-1 min-w-0">
            <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline truncate block">
              Ver reporte
            </a>
          </div>
          <button type="button" onClick={() => onChange('')} className="text-xs text-red-600 hover:underline flex-shrink-0">
            Quitar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={`w-full border-2 border-dashed border-[var(--color-border)] rounded-lg py-6 flex flex-col items-center gap-2 transition-colors ${
            uploading ? 'opacity-60 cursor-not-allowed' : 'hover:border-[var(--color-accent)] cursor-pointer'
          }`}
        >
          <i className={`text-2xl ${uploading ? 'iconoir-hourglass' : 'iconoir-folder'}`} aria-hidden />
          <span className="text-sm font-medium">{uploading ? 'Subiendo…' : 'Subir PDF de inspección'}</span>
          <span className="text-xs text-[var(--color-muted)]">PDF · máx. 15 MB</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          e.target.value = ''
          await handleFile(file)
        }}
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-muted)] flex-shrink-0">o pega un enlace:</span>
        <input
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="https://…"
          className="flex-1 min-w-0 border border-[var(--color-border)] rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
