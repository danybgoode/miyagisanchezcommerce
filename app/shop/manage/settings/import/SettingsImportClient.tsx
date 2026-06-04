'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  buildSettingsCopilotPrompt,
  CONFIG_BLOCKS,
  MANUAL_SECTIONS,
  EXAMPLE_CONFIG,
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
      className="inline-flex items-center gap-1.5 bg-[var(--color-accent)] text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
    >
      {copied ? '✓ Copiado' : `📋 ${label}`}
    </button>
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
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">1</span>
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
          className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-bg,#f7f7f7)] text-[var(--color-foreground)] resize-y"
        />
      </section>

      {/* Step 2: Blocks reference */}
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">2</span>
          Qué puedes configurar por archivo
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-3">Cada bloque es opcional. Incluye solo los que tengas.</p>
        <div className="space-y-2">
          {CONFIG_BLOCKS.map((b) => (
            <div key={String(b.key)} className="flex gap-2 text-sm">
              <code className="font-mono text-xs bg-[var(--color-muted-bg,#f7f7f7)] rounded px-1.5 py-0.5 h-fit">{String(b.key)}</code>
              <span className="text-[var(--color-muted)]">{b.desc}</span>
            </div>
          ))}
        </div>

        {/* Manual sections */}
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
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
      <section className="border border-[var(--color-border)] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-accent)] text-white text-xs font-bold">3</span>
            Ejemplo de archivo
          </h2>
          <CopyButton text={exampleJson} label="Copiar ejemplo" />
        </div>
        <pre className="w-full font-mono text-xs leading-relaxed p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-bg,#f7f7f7)] text-[var(--color-foreground)] overflow-x-auto">
          {exampleJson}
        </pre>
      </section>

      {/* Upload (next story) */}
      <section className="border-2 border-dashed border-[var(--color-border)] rounded-2xl p-8 text-center">
        <div className="text-3xl mb-2">⚙️</div>
        <h2 className="font-semibold mb-1">Subir tu configuración</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Muy pronto vas a poder subir aquí el archivo y aplicar toda tu configuración de una vez. Por
          ahora, prepárala con el prompt de arriba.
        </p>
      </section>
    </div>
  )
}
