'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  buildCopilotPrompt,
  CATALOG_IMPORT_FIELDS,
  EXAMPLE_CATALOG,
  MAX_IMPORT_ROWS,
  parseCatalogFile,
  type CatalogParseResult,
  type ImportIssue,
} from '@/lib/catalog-import'

// ── Copy-to-clipboard button ─────────────────────────────────────────────────

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        } catch {
          // clipboard blocked — no-op; the textarea below is still selectable
        }
      }}
      className="inline-flex items-center gap-1.5 bg-[var(--color-accent)] text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
    >
      {copied ? '✓ Copiado' : `📋 ${label}`}
    </button>
  )
}

// ── Uploader (US-2: pick a file → parse → validate → plain-language errors) ──

function Uploader() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<CatalogParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setResult(null)
    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo es muy grande (máx. 5 MB).')
      return
    }
    try {
      const text = await file.text()
      setFileName(file.name)
      setResult(parseCatalogFile(text, file.name))
    } catch {
      setError('No se pudo leer el archivo. Intenta de nuevo.')
    }
  }

  const validCount = result?.staged.filter((s) => s.valid).length ?? 0
  const errorRowCount = result?.staged.filter((s) => !s.valid).length ?? 0
  const allIssues: ImportIssue[] = result
    ? [...result.fileErrors, ...result.staged.flatMap((s) => s.issues)]
    : []
  const errorIssues = allIssues.filter((i) => i.level === 'error')
  const warningIssues = allIssues.filter((i) => i.level === 'warning')

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = '' // allow re-selecting the same file
        }}
      />

      <div className="border-2 border-dashed border-[var(--color-border)] rounded-2xl p-8 text-center">
        <div className="text-3xl mb-2">📤</div>
        <h2 className="font-semibold mb-1 flex items-center justify-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">4</span>
          Subir tu archivo
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Sube el archivo (CSV o JSON) que generó tu IA. Lo revisamos al instante y te decimos en
          español claro si algo necesita corregirse.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-block bg-[var(--color-accent)] text-white px-6 py-2.5 rounded-lg font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Elegir archivo
        </button>
        {fileName && (
          <p className="text-xs text-[var(--color-muted)] mt-3">📄 {fileName}</p>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4">
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-semibold">
              ✓ {validCount} {validCount === 1 ? 'producto válido' : 'productos válidos'}
            </span>
            {errorRowCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 px-3 py-1 text-sm font-semibold">
                ✕ {errorRowCount} con errores
              </span>
            )}
            {result.format && (
              <span className="text-xs text-[var(--color-muted)] uppercase tracking-wide">
                formato {result.format}
              </span>
            )}
          </div>

          {/* Error cards */}
          {errorIssues.length > 0 && (
            <div className="space-y-2 mb-3">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">
                Corrige esto y vuelve a subir
              </p>
              {errorIssues.map((issue, idx) => (
                <div key={idx} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {issue.message}
                </div>
              ))}
              <p className="text-xs text-[var(--color-muted)]">
                💡 Copia estos mensajes y pégalos a tu IA para que corrija el archivo automáticamente.
              </p>
            </div>
          )}

          {/* Warnings */}
          {warningIssues.length > 0 && (
            <div className="space-y-2 mb-3">
              {warningIssues.map((issue, idx) => (
                <div key={idx} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          {/* Next step (US-3/US-4) */}
          {validCount > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-bg,#f7f7f7)] p-4 text-sm text-[var(--color-muted)]">
              {errorRowCount === 0
                ? `Todo listo: ${validCount} ${validCount === 1 ? 'producto' : 'productos'} sin errores. La vista previa y la publicación llegan en el siguiente paso.`
                : `${validCount} ${validCount === 1 ? 'producto está' : 'productos están'} listos; los demás necesitan corrección.`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ImportClient() {
  const prompt = buildCopilotPrompt()
  const exampleJson = JSON.stringify(EXAMPLE_CATALOG, null, 2)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/shop/manage"
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline"
        >
          ← Mi tienda
        </Link>
        <h1 className="text-2xl font-bold leading-tight mt-2">Importar catálogo</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Trae toda tu tienda en minutos. Deja que tu propio asistente de IA ordene tus datos y súbelos
          aquí — sin formatos complicados ni mapeos manuales.
        </p>
      </div>

      {/* ── Step 1: Copilot prompt ──────────────────────────────────────────── */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">1</span>
            Copilot de catálogo
          </h2>
          <CopyButton text={prompt} label="Copiar prompt" />
        </div>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Copia este prompt y pégalo en tu IA favorita (Claude, ChatGPT o Gemini). Luego dale tus datos
          crudos —listas, notas, mensajes de proveedor, capturas o URLs— y te devolverá un archivo
          listo para subir.
        </p>
        <textarea
          readOnly
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
          rows={12}
          className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-bg,#f7f7f7)] text-[var(--color-foreground)] resize-y"
        />
        <p className="text-xs text-[var(--color-muted)] mt-2">
          💡 ¿Catálogo enorme? Si tus datos superan el límite de tu IA, súbelos primero a{' '}
          <a href="https://notebooklm.google.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline">NotebookLM</a>{' '}
          para condensarlos, y procésalos por partes. Máximo {MAX_IMPORT_ROWS} productos por archivo.
        </p>
      </section>

      {/* ── Step 2: Schema reference ────────────────────────────────────────── */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">2</span>
          Qué campos lleva cada producto
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          El prompt ya incluye este esquema. Esta tabla es solo para referencia.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <th className="py-2 pr-3 font-semibold">Campo</th>
                <th className="py-2 pr-3 font-semibold">Tipo</th>
                <th className="py-2 pr-3 font-semibold">Req.</th>
                <th className="py-2 font-semibold">Notas</th>
              </tr>
            </thead>
            <tbody>
              {CATALOG_IMPORT_FIELDS.map((f) => (
                <tr key={f.name} className="border-b border-[var(--color-border)] align-top">
                  <td className="py-2 pr-3 font-mono">{f.name}</td>
                  <td className="py-2 pr-3 text-[var(--color-muted)]">{f.type}</td>
                  <td className="py-2 pr-3">
                    {f.required
                      ? <span className="text-red-600 font-semibold">sí</span>
                      : <span className="text-[var(--color-muted)]">no</span>}
                  </td>
                  <td className="py-2 text-[var(--color-muted)]">{f.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Step 3: Example ─────────────────────────────────────────────────── */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">3</span>
            Ejemplo de archivo
          </h2>
          <CopyButton text={exampleJson} label="Copiar ejemplo" />
        </div>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Así se ve un archivo válido. Tu IA debe devolver un arreglo JSON con esta forma.
        </p>
        <pre className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-bg,#f7f7f7)] text-[var(--color-foreground)] overflow-x-auto">
          {exampleJson}
        </pre>
      </section>

      {/* ── Step 4: Upload + validate ───────────────────────────────────────── */}
      <Uploader />
    </div>
  )
}
