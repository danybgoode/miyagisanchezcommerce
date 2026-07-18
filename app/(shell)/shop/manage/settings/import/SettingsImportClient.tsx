'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  buildSettingsCopilotPrompt,
  CONFIG_BLOCKS,
  MANUAL_SECTIONS,
  EXAMPLE_CONFIG,
  parseConfigFile,
  validateConfig,
  type BlockResult,
  type StoreConfigManifest,
} from '@/lib/settings-import'

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
      className="inline-flex items-center gap-1.5 bg-[var(--color-accent)] text-white px-3 py-1.5 rounded-[var(--r-md)] text-xs font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
    >
      {copied ? <><i className="iconoir-check" aria-hidden /> Copiado</> : <><i className="iconoir-copy" aria-hidden /> {label}</>}
    </button>
  )
}

// ── Per-block result row (preview + report) ──────────────────────────────────

function BlockRow({ b }: { b: BlockResult }) {
  const ok = b.status === 'applied'
  return (
    <div className={`rounded-[var(--r-md)] border p-3 ${ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{b.label}</span>
        <span className={`text-xs font-semibold ${ok ? 'text-green-700' : 'text-red-700'}`}>
          {ok ? <><i className="iconoir-check" aria-hidden /> {b.appliedFields.length} campo(s)</> : <><i className="iconoir-xmark" aria-hidden /> omitido</>}
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

function ConfigUploader() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [manifest, setManifest] = useState<StoreConfigManifest | null>(null)
  const [preview, setPreview] = useState<BlockResult[] | null>(null)
  const [report, setReport] = useState<BlockResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  async function handleFile(file: File) {
    setError(null); setManifest(null); setPreview(null); setReport(null); setFileName(null)
    if (file.size > 2 * 1024 * 1024) { setError('El archivo es muy grande (máx. 2 MB).'); return }
    try {
      const text = await file.text()
      const { manifest: m, error: e } = parseConfigFile(text)
      if (!m) { setError(e ?? 'Archivo inválido.'); return }
      setFileName(file.name)
      setManifest(m)
      setPreview(validateConfig(m).blocks)
    } catch {
      setError('No se pudo leer el archivo. Intenta de nuevo.')
    }
  }

  async function apply() {
    if (!manifest) return
    setApplying(true); setError(null)
    try {
      const res = await fetch('/api/sell/settings-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; blocks?: BlockResult[]; error?: string }
      if (!res.ok) { setError(data.error ?? 'No se pudo aplicar la configuración.'); if (data.blocks) setPreview(data.blocks); return }
      setReport(data.blocks ?? [])
      // Invalidate the router cache so the settings list re-fetches and its
      // completion checkmarks reflect what we just applied (US-4).
      router.refresh()
    } catch {
      setError('No se pudo aplicar la configuración. Intenta de nuevo.')
    } finally {
      setApplying(false)
    }
  }

  const appliedCount = (preview ?? []).filter((b) => b.status === 'applied').length

  return (
    <section className="border-2 border-dashed border-[var(--color-border)] rounded-[var(--r-lg)] p-6">
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />

      {!report && (
        <div className="text-center">
          <div className="text-3xl mb-2"><i className="iconoir-settings" aria-hidden /></div>
          <h2 className="font-semibold mb-1">Subir tu configuración</h2>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            Sube el archivo JSON que generó tu IA. Te mostramos qué se va a aplicar antes de guardar.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-block bg-[var(--color-accent)] text-white px-6 py-2.5 rounded-[var(--r-md)] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            Elegir archivo
          </button>
          {fileName && <p className="text-xs text-[var(--color-muted)] mt-3"><i className="iconoir-page" aria-hidden /> {fileName}</p>}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[var(--r-md)] border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Preview before applying */}
      {preview && !report && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-sm font-medium">Se aplicarán <strong>{appliedCount}</strong> bloque(s)</p>
            <button
              type="button"
              onClick={apply}
              disabled={applying || appliedCount === 0}
              className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-[var(--r-md)] text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? 'Aplicando…' : 'Aplicar configuración'}
            </button>
          </div>
          <div className="space-y-2">
            {preview.map((b) => <BlockRow key={b.key} b={b} />)}
          </div>
        </div>
      )}

      {/* Delta report after applying */}
      {report && (
        <div>
          <div className="text-center mb-4">
            <div className="text-3xl mb-2"><i className="iconoir-check-circle" aria-hidden /></div>
            <h2 className="font-semibold">Configuración aplicada</h2>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              <Link href="/shop/manage/settings" className="text-[var(--color-accent)] hover:underline">Ver mi configuración →</Link>
            </p>
          </div>
          <div className="space-y-2">
            {report.map((b) => <BlockRow key={b.key} b={b} />)}
          </div>
        </div>
      )}
    </section>
  )
}

export default function SettingsImportClient() {
  const prompt = buildSettingsCopilotPrompt()
  const exampleJson = JSON.stringify(EXAMPLE_CONFIG, null, 2)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/shop/manage/settings" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline">
          ← Configuración
        </Link>
        <h1 className="text-2xl font-bold leading-tight mt-2">Importar configuración</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Trae la configuración de tu tienda de otra plataforma en un solo archivo. Tu IA la convierte
          al formato de Miyagi y aquí la aplicas de un jalón — sin pasar por cada pantalla.
        </p>
      </div>

      {/* Step 1: Copilot prompt */}
      <section className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--r-pill)] bg-[var(--color-accent)] text-white text-xs font-bold">1</span>
            Copilot de configuración
          </h2>
          <CopyButton text={prompt} label="Copiar prompt" />
        </div>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Copia este prompt en tu IA (Claude, ChatGPT o Gemini) y dale capturas o textos de la
          configuración de tu tienda actual. Te devolverá un archivo listo para subir.
        </p>
        <textarea
          readOnly
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
          rows={12}
          className="w-full font-mono text-xs leading-relaxed p-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg)] resize-y"
        />
      </section>

      {/* Step 2: Blocks reference */}
      <section className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--r-pill)] bg-[var(--color-accent)] text-white text-xs font-bold">2</span>
          Qué puedes configurar por archivo
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-3">Cada bloque es opcional. Incluye solo los que tengas.</p>
        <div className="space-y-2">
          {CONFIG_BLOCKS.map((b) => (
            <div key={String(b.key)} className="flex gap-2 text-sm">
              <code className="font-mono text-xs bg-[var(--surface-muted)] rounded-[var(--r-sm)] px-1.5 py-0.5 h-fit">{String(b.key)}</code>
              <span className="text-[var(--color-muted)]">{b.desc}</span>
            </div>
          ))}
        </div>

        {/* Manual sections */}
        <div className="mt-4 rounded-[var(--r-md)] border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1.5">Esto se queda en un paso manual (por seguridad):</p>
          <ul className="space-y-1">
            {MANUAL_SECTIONS.map((m) => (
              <li key={m.key} className="text-xs text-amber-800">
                <strong>{m.label}.</strong> {m.why}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Step 3: Example */}
      <section className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--r-pill)] bg-[var(--color-accent)] text-white text-xs font-bold">3</span>
            Ejemplo de archivo
          </h2>
          <CopyButton text={exampleJson} label="Copiar ejemplo" />
        </div>
        <pre className="w-full font-mono text-xs leading-relaxed p-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg)] overflow-x-auto">
          {exampleJson}
        </pre>
      </section>

      {/* Upload + apply */}
      <ConfigUploader />
    </div>
  )
}
