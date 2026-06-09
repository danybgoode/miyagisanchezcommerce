'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  validateSetup,
  buildSetupPrompt,
  buildClerkPrompt,
  EXAMPLE_SETUP,
  SETUP_SPEC_VERSION,
  type MiyagiSetupFile,
} from '@/lib/setup-spec'
import ConnectAgentPanel from '@/components/ConnectAgentPanel'
import {
  planSetupApply,
  aggregateSetupReport,
  chunkFailureRows,
  type SetupApplyReport,
  type RowResult,
} from '@/lib/setup-apply'
import { CATALOG_CATEGORY_KEYS } from '@/lib/catalog-import'
import { type BlockResult } from '@/lib/settings-import'

// ── Copy-to-clipboard (mirrors the import clients) ────────────────────────────
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
          /* clipboard blocked — textarea is still selectable */
        }
      }}
      className="inline-flex items-center gap-1.5 bg-[var(--color-accent)] text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
    >
      {copied ? '✓ Copiado' : `📋 ${label}`}
    </button>
  )
}

// ── Per-block result row (preview + report) — same shape as SettingsImportClient
function BlockRow({ b }: { b: BlockResult }) {
  const ok = b.status === 'applied'
  return (
    <div className={`rounded-lg border p-3 ${ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{b.label}</span>
        <span className={`text-xs font-semibold ${ok ? 'text-green-700' : 'text-red-700'}`}>
          {ok ? `✓ ${b.appliedFields.length} campo(s)` : '✕ omitido'}
        </span>
      </div>
      {b.issues.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {b.issues.map((iss, i) => (
            <li key={i} className="text-xs text-red-700">• {iss}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

type ValidatedSetup = ReturnType<typeof validateSetup>

function FirstRunApply() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pasteText, setPasteText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  // The parsed + validated setup file (staging preview source).
  const [file, setFile] = useState<MiyagiSetupFile | null>(null)
  const [validated, setValidated] = useState<ValidatedSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Apply state
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<SetupApplyReport | null>(null)

  function review(text: string, source: 'paste' | 'file', name?: string) {
    setError(null); setFile(null); setValidated(null); setReport(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setError('El texto no es un JSON válido. Pega el objeto completo que generó tu agente.')
      return
    }
    const v = validateSetup(parsed)
    if (!v.ok) {
      // Unknown/missing version or not an object — a clear error, no partial parse.
      setError(v.version_error ?? 'El archivo de configuración no es válido.')
      return
    }
    if (source === 'file' && name) setFileName(name)
    setFile(parsed as MiyagiSetupFile)
    setValidated(v)
  }

  async function handleFile(f: File) {
    setFileName(null)
    if (f.size > 5 * 1024 * 1024) { setError('El archivo es muy grande (máx. 5 MB).'); return }
    try {
      review(await f.text(), 'file', f.name)
    } catch {
      setError('No se pudo leer el archivo. Intenta de nuevo.')
    }
  }

  // Walk the plan over the EXISTING apply routes in order: shop → config → catalog.
  // Each step degrades gracefully; the combined report shows exactly what applied.
  async function runApply() {
    if (!file) return
    setApplying(true); setError(null)
    const plan = planSetupApply(file)
    const totalRows = plan.catalogChunks.reduce((s, c) => s + c.length, 0)
    setProgress({ done: 0, total: totalRows })

    try {
      // 1 — create-shop-if-missing (idempotent: 201 created / 200 existed).
      const shopRes = await fetch('/api/sell/shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.shop),
      })
      const shopData = (await shopRes.json().catch(() => ({}))) as { shopSlug?: string; error?: string }
      const shopPart = { ok: shopRes.ok, status: shopRes.status, shopSlug: shopData.shopSlug ?? null }

      // The shop is the prerequisite for config + catalog — if it failed, stop here
      // (nothing else can apply) and report it.
      if (!shopRes.ok) {
        setError(shopData.error ?? 'No se pudo crear tu tienda. Inténtalo de nuevo.')
        setReport(aggregateSetupReport({ shop: shopPart, config: null, catalogChunks: [] }))
        return
      }

      // 2 — config (optional; a failed block never blocks the catalog).
      let configPart: { ok: boolean; blocks?: BlockResult[] } | null = null
      if (plan.configManifest) {
        const cRes = await fetch('/api/sell/settings-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifest: plan.configManifest }),
        })
        const cData = (await cRes.json().catch(() => ({}))) as { blocks?: BlockResult[] }
        configPart = { ok: cRes.ok, blocks: cData.blocks ?? [] }
      }

      // 3 — catalog in ≤25-row chunks; live progress; per-chunk graceful degrade.
      const chunkParts: Array<{ results?: RowResult[] }> = []
      let line = 1
      let done = 0
      for (const chunk of plan.catalogChunks) {
        try {
          const res = await fetch('/api/sell/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: chunk }),
          })
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string }
            chunkParts.push({ results: chunkFailureRows(chunk, line, err.error ?? `Error ${res.status}.`) })
          } else {
            const data = (await res.json()) as { results: RowResult[] }
            chunkParts.push({ results: data.results })
          }
        } catch {
          chunkParts.push({ results: chunkFailureRows(chunk, line, 'Se interrumpió la conexión.') })
        }
        line += chunk.length
        done += chunk.length
        setProgress({ done, total: totalRows })
        setReport(aggregateSetupReport({ shop: shopPart, config: configPart, catalogChunks: chunkParts }))
      }

      setReport(aggregateSetupReport({ shop: shopPart, config: configPart, catalogChunks: chunkParts }))
    } catch {
      setError('Algo falló al aplicar tu configuración. Revisa el reporte e inténtalo de nuevo.')
    } finally {
      setApplying(false)
    }
  }

  const catalogRows = validated?.catalog ?? []
  const validRows = catalogRows.filter((s) => s.valid)
  const errorRows = catalogRows.filter((s) => !s.valid)
  const configBlocks = (validated?.config?.blocks ?? []).filter((b) => b.status === 'applied')

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />

      {/* ── Paste / upload the setup file ──────────────────────────────────── */}
      {!report && (
        <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-4">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <span className="text-xl">✨</span> Pega el archivo de tu agente
          </h2>
          <p className="text-sm text-[var(--color-muted)] mb-3">
            Tu agente ya armó tu tienda en un solo archivo. Pégalo aquí (o súbelo) y lo revisamos antes de
            crear tu tienda y tu catálogo de un jalón.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder={'Pega aquí el objeto JSON completo: { "miyagi_setup_version": "1", "profile": {…}, "config": {…}, "catalog": [...] }'}
            className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] resize-y"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="border border-[var(--border)] text-[var(--fg)] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--surface-muted)] transition-colors"
            >
              o sube un archivo (.json)
            </button>
            <button
              type="button"
              onClick={() => review(pasteText, 'paste')}
              disabled={!pasteText.trim()}
              className="bg-[var(--accent)] text-[var(--fg-inverse)] px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Revisar
            </button>
          </div>
          {fileName && <p className="text-xs text-[var(--color-muted)] mt-3">📄 {fileName}</p>}
        </section>
      )}

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* ── Staging preview (before confirm) ───────────────────────────────── */}
      {validated && !report && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-semibold">
                ✓ {validRows.length} {validRows.length === 1 ? 'producto listo' : 'productos listos'}
              </span>
              {configBlocks.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-sm font-semibold">
                  ⚙️ {configBlocks.length} bloque(s) de config
                </span>
              )}
              {errorRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 px-3 py-1 text-sm font-semibold">
                  ✕ {errorRows.length} con error
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={runApply}
              disabled={applying || (validRows.length === 0 && configBlocks.length === 0)}
              className="bg-[var(--accent)] text-[var(--fg-inverse)] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? `Creando ${progress.done}/${progress.total}…` : 'Crear mi tienda y catálogo'}
            </button>
          </div>

          {/* Config blocks preview */}
          {configBlocks.length > 0 && (
            <div className="space-y-2 mb-3">
              {(validated.config?.blocks ?? []).map((b) => <BlockRow key={b.key} b={b} />)}
            </div>
          )}

          {/* Catalog staging grid (read-only — the agent emitted it) */}
          {catalogRows.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
                      <th className="py-2 px-3 font-semibold">Título</th>
                      <th className="py-2 px-3 font-semibold">Categoría</th>
                      <th className="py-2 px-3 font-semibold">Precio</th>
                      <th className="py-2 px-3 font-semibold">SKU</th>
                      <th className="py-2 px-3 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogRows.map((s, i) => {
                      const cat = CATALOG_CATEGORY_KEYS.includes(s.row.category) ? s.row.category : (s.row.category || '—')
                      return (
                        <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${s.valid ? '' : 'bg-red-50/40'}`}>
                          <td className="py-2 px-3 min-w-[12rem]">{s.row.title || '(sin título)'}</td>
                          <td className="py-2 px-3">{cat}</td>
                          <td className="py-2 px-3 whitespace-nowrap">{s.row.price != null ? `$${s.row.price.toLocaleString('es-MX')}` : 'a convenir'}</td>
                          <td className="py-2 px-3 font-mono">{s.row.external_id || '—'}</td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {s.valid
                              ? <span className="inline-block rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-semibold">Listo</span>
                              : <span className="inline-block rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-semibold" title={s.issues.find((iss) => iss.level === 'error')?.message}>Corregir</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {errorRows.length > 0 && (
                <p className="px-4 py-2 text-xs text-[var(--color-muted)] border-t border-[var(--color-border)]">
                  💡 Las filas con error se omiten; las válidas se crean igual. Puedes corregirlas luego en{' '}
                  <Link href="/shop/manage/import" className="text-[var(--color-accent)] hover:underline">Importar catálogo</Link>.
                </p>
              )}
              {applying && (
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
        </div>
      )}

      {/* ── Land-in-shop report ────────────────────────────────────────────── */}
      {report && <SetupReport report={report} />}
    </div>
  )
}

// ── The post-apply summary (Story 2.2 land-in-shop) ───────────────────────────
function SetupReport({ report }: { report: SetupApplyReport }) {
  const { shop, shopSlug, config, catalog } = report
  const shopOk = shop !== 'failed'
  const appliedBlocks = config.filter((b) => b.status === 'applied').length
  const failedRows = catalog.rows.filter((r) => r.status === 'failed')

  return (
    <div className="mt-2">
      <div className="text-center mb-5">
        <div className="text-4xl mb-2">{shopOk ? '🎉' : '⚠️'}</div>
        <h2 className="text-xl font-bold">
          {shop === 'created' ? '¡Tu tienda está lista!' : shop === 'existed' ? 'Tu tienda se actualizó' : 'No pudimos crear tu tienda'}
        </h2>
        {shopOk && (
          <p className="text-sm text-[var(--color-muted)] mt-1">
            {shop === 'created' ? 'Creamos tu tienda' : 'Usamos tu tienda existente'}
            {catalog.created > 0 && ` · ${catalog.created} producto(s) nuevo(s)`}
            {catalog.updated > 0 && ` · ${catalog.updated} actualizado(s)`}
            {appliedBlocks > 0 && ` · ${appliedBlocks} bloque(s) de configuración`}.
          </p>
        )}
      </div>

      {/* Result chips */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
        {catalog.created > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-semibold">✓ {catalog.created} creados</span>
        )}
        {catalog.updated > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-sm font-semibold">↻ {catalog.updated} actualizados</span>
        )}
        {catalog.failed > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 px-3 py-1 text-sm font-semibold">✕ {catalog.failed} fallaron</span>
        )}
      </div>

      {/* Config block deltas */}
      {config.length > 0 && (
        <div className="space-y-2 mb-4">
          {config.map((b) => <BlockRow key={b.key} b={b} />)}
        </div>
      )}

      {/* Failed rows detail */}
      {failedRows.length > 0 && (
        <div className="space-y-2 mb-4">
          {failedRows.map((r, i) => (
            <div key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <strong>{r.title}</strong>: {r.reason}
            </div>
          ))}
        </div>
      )}

      {/* Land-in-shop CTAs */}
      {shopOk ? (
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mt-6">
          <Link href="/shop/manage" className="btn btn-primary btn-lg no-underline w-full sm:w-auto text-center">
            Ir a mi tienda →
          </Link>
          {shopSlug && (
            <Link href={`/s/${shopSlug}`} className="btn btn-secondary btn-lg no-underline w-full sm:w-auto text-center">
              Ver mi tienda pública
            </Link>
          )}
        </div>
      ) : (
        <div className="flex justify-center mt-6">
          <Link href="/sell/setup" className="btn btn-secondary no-underline">Intentar de nuevo</Link>
        </div>
      )}

      {/* ── Close the loop: your agent as your shop clerk + what's next (Story 3) ── */}
      {shopOk && <LoopClose shopSlug={shopSlug} />}
    </div>
  )
}

// ── Post-setup loop-close: clerk prompt + connect-agent + what's next ─────────────
function LoopClose({ shopSlug }: { shopSlug: string | null }) {
  const clerkPrompt = buildClerkPrompt()
  return (
    <div className="mt-10 pt-6 border-t border-[var(--color-border)] space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-bold">Deja que tu agente lleve tu tienda</h3>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Tu tienda ya está creada. Estos dos pasos hacen que tu propio agente la opere de aquí en adelante.
        </p>
      </div>

      {/* 1 — the copyable shop-clerk operate-prompt */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h4 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">1</span>
            Tu agente como tu dependiente
          </h4>
          <CopyButton text={clerkPrompt} label="Copiar prompt del dependiente" />
        </div>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Copia este prompt en tu IA (Claude u otro cliente MCP), junto con tu token de abajo, y tu agente
          podrá pulir, fijar precios, promover, resurtir y mantener tu tienda — en tu idioma.
        </p>
        <textarea
          readOnly
          value={clerkPrompt}
          onFocus={(e) => e.currentTarget.select()}
          rows={12}
          className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg)] resize-y"
        />
      </section>

      {/* 2 — the per-shop MCP token + config (reused ConnectAgentPanel) */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5">
        <h4 className="font-semibold flex items-center gap-2 mb-3">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">2</span>
          Conecta tu agente
        </h4>
        <ConnectAgentPanel />
      </section>

      {/* 3 — what's next */}
      <section className="rounded-2xl bg-[var(--surface-muted)] p-5">
        <h4 className="font-semibold mb-2">¿Qué sigue?</h4>
        <ul className="text-sm text-[var(--color-muted)] space-y-1.5">
          <li>
            💳 <strong className="text-[var(--color-foreground)] font-medium">Agrega pagos</strong> — sigue
            siendo un paso manual. Configúralos en{' '}
            <Link href="/shop/manage/settings" className="text-[var(--color-accent)] hover:underline">ajustes de tu tienda</Link>.
          </li>
          <li>
            🔗 <strong className="text-[var(--color-foreground)] font-medium">Comparte tu tienda</strong>
            {shopSlug
              ? <> — tu enlace público es <Link href={`/s/${shopSlug}`} className="text-[var(--color-accent)] hover:underline">/s/{shopSlug}</Link>.</>
              : <> desde el panel de tu tienda.</>}
          </li>
          <li>
            🤖 <strong className="text-[var(--color-foreground)] font-medium">Deja que tu agente la lleve</strong> —
            con el prompt y el token de arriba, tu IA se encarga del día a día.
          </li>
        </ul>
      </section>
    </div>
  )
}

// ── Page wrapper: header + apply + the "how to get the file" reference ────────
export default function SetupClient() {
  const prompt = buildSetupPrompt()
  const exampleJson = JSON.stringify(EXAMPLE_SETUP, null, 2)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/sell" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline">
          ← Vender
        </Link>
        <h1 className="text-2xl font-bold leading-tight mt-2">Arma tu tienda con tu agente</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Si tu agente de IA ya generó tu archivo de configuración, pégalo abajo y creamos tu tienda y tu
          catálogo en un solo paso. ¿Aún no lo tienes? Copia el prompt y dáselo a tu agente.
        </p>
      </div>

      {/* Apply (paste/upload → staging → confirm → land-in-shop) */}
      <FirstRunApply />

      {/* How to produce the file — the S1 prompt + example, for sellers who don't have it yet */}
      <div className="mt-10 pt-6 border-t border-[var(--color-border)]">
        <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="font-semibold flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">1</span>
              Prompt para tu agente
            </h2>
            <CopyButton text={prompt} label="Copiar prompt" />
          </div>
          <p className="text-sm text-[var(--color-muted)] mb-3">
            Copia este prompt en tu IA (Claude, ChatGPT o Gemini), dale tus datos crudos (catálogo,
            capturas, notas) y te devolverá UN solo archivo. Pégalo arriba.
          </p>
          <textarea
            readOnly
            value={prompt}
            onFocus={(e) => e.currentTarget.select()}
            rows={12}
            className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg)] resize-y"
          />
        </section>

        <section className="border border-[var(--color-border)] rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="font-semibold flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">2</span>
              Ejemplo de archivo (versión {SETUP_SPEC_VERSION})
            </h2>
            <CopyButton text={exampleJson} label="Copiar ejemplo" />
          </div>
          <pre className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg)] overflow-x-auto max-h-80">
            {exampleJson}
          </pre>
        </section>
      </div>
    </div>
  )
}
