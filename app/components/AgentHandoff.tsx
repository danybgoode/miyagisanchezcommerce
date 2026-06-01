'use client'

import { useState } from 'react'

/**
 * Inline "hand off to your AI agent" card. Mirrors AIAgentButton: copies a
 * context-filled prompt and opens Claude (claude.ai/new?q=…). The agent reads
 * the marketplace briefing at /agent, connects to the MCP server, and drives
 * the task (e.g. opening or resolving a refund) on the user's behalf.
 */
export default function AgentHandoff({
  prompt,
  buttonLabel = 'Abrir en Claude',
  title = 'Resolver con tu agente IA',
  subtitle = 'Copia el prompt y ábrelo en Claude. Tu agente leerá la ficha del marketplace, usará el MCP y te ayudará paso a paso.',
}: {
  prompt: string
  buttonLabel?: string
  title?: string
  subtitle?: string
}) {
  const [copied, setCopied] = useState(false)
  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      /* clipboard blocked — user can still open Claude with the prefilled prompt */
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-xl p-4 bg-[var(--color-surface-alt)]">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="text-base mt-0.5 flex-shrink-0">✦</span>
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-relaxed">{subtitle}</p>
        </div>
      </div>

      {/* Prompt preview */}
      <pre className="text-[11px] text-[var(--color-muted)] bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg p-2.5 mb-3 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
        {prompt}
      </pre>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex-1 text-sm font-semibold py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] bg-[var(--color-background)] hover:bg-[var(--color-surface-alt)] transition-colors flex items-center justify-center gap-1.5"
        >
          {copied ? '✓ ¡Copiado!' : '⧉ Copiar prompt'}
        </button>
        <a
          href={claudeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm font-semibold py-2.5 rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] no-underline transition-colors flex items-center justify-center gap-1.5"
        >
          ✦ {buttonLabel}
        </a>
      </div>

      <a
        href="/agent"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline mt-2"
      >
        ¿Qué puede hacer mi agente? · Ficha del marketplace →
      </a>
    </div>
  )
}
