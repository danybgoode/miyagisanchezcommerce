'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  buildCopilotPrompt,
  CATALOG_IMPORT_FIELDS,
  EXAMPLE_CATALOG,
  MAX_IMPORT_ROWS,
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

      {/* ── Upload (next story) ─────────────────────────────────────────────── */}
      <section className="border-2 border-dashed border-[var(--color-border)] rounded-2xl p-8 text-center">
        <div className="text-3xl mb-2">📤</div>
        <h2 className="font-semibold mb-1">Subir tu archivo</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Muy pronto vas a poder subir aquí el archivo que generó tu IA y publicar todo tu catálogo de
          una vez. Por ahora, prepara tu archivo con el prompt de arriba.
        </p>
      </section>
    </div>
  )
}
