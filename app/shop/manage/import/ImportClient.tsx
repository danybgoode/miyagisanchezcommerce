'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  buildCopilotPrompt,
  CATALOG_IMPORT_FIELDS,
  EXAMPLE_CATALOG,
  MAX_IMPORT_ROWS,
  EXTRACT_CHAR_LIMIT,
  parseCatalogFile,
  type CatalogParseResult,
  type CatalogImportRow,
  type ImportIssue,
} from '@/lib/catalog-import'

/** Must match CHUNK_MAX in app/api/sell/import/route.ts. */
const IMPORT_CHUNK = 25

type RowResult = {
  line: number
  title: string
  status: 'created' | 'updated' | 'failed'
  product_id?: string
  reason?: string
  images_failed?: number
}

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

function priceLabel(price?: number, currency?: string) {
  if (price === undefined) return 'A convenir'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency ?? 'MXN', maximumFractionDigits: 0 }).format(price)
}

function Uploader() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<CatalogParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [existingIds, setExistingIds] = useState<Set<string> | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<RowResult[] | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [extracting, setExtracting] = useState(false)

  // Shared by both inputs (file + paste): show staging and fetch existing ids.
  async function applyResult(parsed: CatalogParseResult) {
    setReport(null)
    setProgress({ done: 0, total: 0 })
    setExistingIds(null)
    setResult(parsed)
    if (parsed.staged.some((s) => s.valid)) {
      try {
        const res = await fetch('/api/sell/import/existing')
        if (res.ok) {
          const data = (await res.json()) as { external_ids?: string[] }
          setExistingIds(new Set(data.external_ids ?? []))
        }
      } catch {
        // Non-fatal: without the set, every row simply previews as "Nuevo".
      }
    }
  }

  async function handleFile(file: File) {
    setError(null)
    setResult(null)
    setFileName(null)
    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo es muy grande (máx. 5 MB).')
      return
    }
    try {
      const text = await file.text()
      setFileName(file.name)
      await applyResult(parseCatalogFile(text, file.name))
    } catch {
      setError('No se pudo leer el archivo. Intenta de nuevo.')
    }
  }

  async function handleExtract() {
    if (!pasteText.trim() || pasteText.length > EXTRACT_CHAR_LIMIT) return
    setError(null)
    setResult(null)
    setFileName(null)
    setExtracting(true)
    try {
      const res = await fetch('/api/sell/import/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        staged?: CatalogParseResult['staged']
        fileErrors?: CatalogParseResult['fileErrors']
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'No se pudo extraer el catálogo. Inténtalo de nuevo.')
        return
      }
      await applyResult({ format: 'json', staged: data.staged ?? [], fileErrors: data.fileErrors ?? [] })
    } catch {
      setError('No se pudo contactar al servicio de IA. Inténtalo de nuevo.')
    } finally {
      setExtracting(false)
    }
  }

  async function runImport(rows: CatalogImportRow[]) {
    setImporting(true)
    setError(null)
    const all: RowResult[] = []
    setProgress({ done: 0, total: rows.length })
    try {
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const chunk = rows.slice(i, i + IMPORT_CHUNK)
        const res = await fetch('/api/sell/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string }
          setError(err.error ?? 'No se pudo completar la importación.')
          break
        }
        const data = (await res.json()) as { results: RowResult[] }
        all.push(...data.results)
        setProgress({ done: Math.min(i + chunk.length, rows.length), total: rows.length })
        setReport([...all])
      }
    } catch {
      setError('Se interrumpió la importación. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setImporting(false)
    }
  }

  const validRows = result?.staged.filter((s) => s.valid) ?? []
  const validCount = validRows.length
  const errorRowCount = result?.staged.filter((s) => !s.valid).length ?? 0
  const isExisting = (extId?: string) => !!(extId && existingIds?.has(extId))
  const updateCount = validRows.filter((s) => isExisting(s.row.external_id)).length
  const createCount = validCount - updateCount
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

      {/* Paste & publish (Sprint 2) — the easy, native path */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-4">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <span className="text-xl">✨</span> Pega y publica
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Pega lo que sea —listas, descripciones, mensajes de proveedor o notas— y nuestra IA arma tu
          catálogo. Tú lo revisas antes de publicar.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={7}
          placeholder={'Ej.\nBicicleta de montaña Trek rodada 29, seminueva, $8,500, Guadalajara\nClases de guitarra a domicilio, $350 la hora, CDMX\n…'}
          className="w-full text-sm p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg,#fff)] text-[var(--color-foreground)] resize-y"
          maxLength={EXTRACT_CHAR_LIMIT + 5000}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <span className={`text-xs ${pasteText.length > EXTRACT_CHAR_LIMIT ? 'text-red-600 font-semibold' : 'text-[var(--color-muted)]'}`}>
            {pasteText.length.toLocaleString('es-MX')} / {EXTRACT_CHAR_LIMIT.toLocaleString('es-MX')} caracteres
          </span>
          <button
            type="button"
            onClick={handleExtract}
            disabled={extracting || !pasteText.trim() || pasteText.length > EXTRACT_CHAR_LIMIT}
            className="bg-[var(--color-accent)] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {extracting ? 'Extrayendo…' : 'Extraer productos'}
          </button>
        </div>
        {pasteText.length > EXTRACT_CHAR_LIMIT && (
          <p className="text-xs text-red-600 mt-2">
            Te pasaste del límite. Para catálogos grandes, usa tu propia IA y sube el archivo (más abajo).
          </p>
        )}
      </section>

      {/* File upload — for files generated by the seller's own AI */}
      <div className="border-2 border-dashed border-[var(--color-border)] rounded-2xl p-6 text-center">
        <h2 className="font-semibold mb-1 text-sm">o sube un archivo (CSV o JSON)</h2>
        <p className="text-xs text-[var(--color-muted)] mb-3">
          ¿Ya tienes un archivo de tu propia IA? Súbelo y lo revisamos al instante.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-block border border-[var(--color-border)] text-[var(--color-foreground)] px-5 py-2 rounded-lg text-sm font-medium hover:bg-[var(--color-muted-bg,#f7f7f7)] transition-colors"
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

          {/* Staging preview (US-3) */}
          {validCount > 0 && (
            <div className="rounded-2xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[var(--color-muted-bg,#f7f7f7)] border-b border-[var(--color-border)]">
                <p className="text-sm font-medium">
                  {createCount > 0 && <>Se crearán <strong>{createCount}</strong></>}
                  {createCount > 0 && updateCount > 0 && ' · '}
                  {updateCount > 0 && <>Se actualizarán <strong>{updateCount}</strong></>}
                  {existingIds === null && createCount > 0 && updateCount === 0 && (
                    <span className="text-[var(--color-muted)] font-normal"> producto(s)</span>
                  )}
                </p>
                <button
                  type="button"
                  disabled={importing || !!report}
                  onClick={() => runImport(validRows.map((s) => s.row))}
                  className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing
                    ? `Procesando ${progress.done}/${progress.total}…`
                    : report
                      ? 'Importado'
                      : `Confirmar e importar (${validCount})`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
                      <th className="py-2 px-3 font-semibold">Producto</th>
                      <th className="py-2 px-3 font-semibold">Precio</th>
                      <th className="py-2 px-3 font-semibold">SKU</th>
                      <th className="py-2 px-3 font-semibold">Inv.</th>
                      <th className="py-2 px-3 font-semibold">Fotos</th>
                      <th className="py-2 px-3 font-semibold">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((s) => (
                      <tr key={s.line} className="border-b border-[var(--color-border)] last:border-0 align-top">
                        <td className="py-2 px-3 max-w-[16rem]">
                          <div className="font-medium truncate">{s.row.title}</div>
                          <div className="text-[var(--color-muted)] capitalize">{s.row.category}</div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">{priceLabel(s.row.price, s.row.currency)}</td>
                        <td className="py-2 px-3 font-mono text-[var(--color-muted)]">{s.row.external_id ?? '—'}</td>
                        <td className="py-2 px-3">{s.row.quantity ?? 1}</td>
                        <td className="py-2 px-3">{s.row.images?.length ?? 0}</td>
                        <td className="py-2 px-3">
                          {isExisting(s.row.external_id) ? (
                            <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 font-semibold">Actualizar</span>
                          ) : (
                            <span className="inline-block rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-semibold">Nuevo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importing && (
                <div className="px-4 py-3 border-t border-[var(--color-border)]">
                  <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all"
                      style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Import report (US-4) */}
          {report && (() => {
            const created = report.filter((r) => r.status === 'created').length
            const updated = report.filter((r) => r.status === 'updated').length
            const failed = report.filter((r) => r.status === 'failed')
            const imagesFailed = report.reduce((sum, r) => sum + (r.images_failed ?? 0), 0)
            return (
              <div className="mt-4 rounded-2xl border border-[var(--color-border)] p-4">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  {created > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-semibold">✓ {created} creados</span>
                  )}
                  {updated > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-sm font-semibold">↻ {updated} actualizados</span>
                  )}
                  {failed.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 px-3 py-1 text-sm font-semibold">✕ {failed.length} fallaron</span>
                  )}
                </div>
                {failed.length > 0 ? (
                  <div className="space-y-2">
                    {failed.map((r) => (
                      <div key={r.line} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        <strong>{r.title}</strong>: {r.reason}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-muted)]">
                    ¡Listo! Tu catálogo ya está publicado.{' '}
                    <Link href="/shop/manage" className="text-[var(--color-accent)] hover:underline">Ver mis anuncios →</Link>
                  </p>
                )}
                {imagesFailed > 0 && (
                  <p className="text-xs text-amber-700 mt-2">
                    ⚠️ {imagesFailed} imagen(es) no se pudieron traer y se dejaron con su enlace original.
                  </p>
                )}
              </div>
            )
          })()}
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
          Trae toda tu tienda en minutos. Pega tu texto y deja que la IA lo arme, o sube un archivo que
          generó tu propio asistente — sin formatos complicados ni mapeos manuales.
        </p>
      </div>

      {/* ── Upload / paste + staging + import ───────────────────────────────── */}
      <Uploader />

      {/* ── Advanced path: use your own AI for big catalogs ─────────────────── */}
      <div className="mt-10 mb-4 pt-6 border-t border-[var(--color-border)]">
        <h2 className="font-semibold">¿Catálogo grande? Usa tu propia IA</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Para catálogos extensos, copia este prompt en tu IA (Claude, ChatGPT o Gemini), genera un
          archivo y súbelo arriba. Así no hay límite de tamaño.
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
    </div>
  )
}
