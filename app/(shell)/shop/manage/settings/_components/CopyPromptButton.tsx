'use client'

/**
 * "Pregunta a tu IA" — copies a ready-made prompt to the clipboard so a seller
 * can get an independent second opinion from their own AI. Promoted verbatim out
 * of the ShopSettings monolith so the extracted sections (Perfil, Diseño, Citas)
 * reuse the same presentational primitive.
 */

import { useState } from 'react'

export function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(prompt)
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
      }}
      title="Copia este prompt y pégalo en Claude, ChatGPT o tu IA favorita para obtener una opinión independiente"
      className={`inline-flex items-center gap-1.5 text-xs border rounded-[var(--r-pill)] px-3 py-1 transition-colors whitespace-nowrap ${
        copied
          ? 'border-[var(--success)] text-[var(--success)] bg-[var(--success-soft)]'
          : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
      }`}
    >
      <i className="iconoir-cpu" aria-hidden />
      {copied ? '¡Copiado! Pégalo en tu IA' : 'Pregunta a tu IA'}
    </button>
  )
}
