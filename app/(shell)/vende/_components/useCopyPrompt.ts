'use client'

import { useState } from 'react'

// Shared clipboard-copy logic for the directive-prompt surfaces (TrustPromptCopy + PromptBlock).
// Writes the prompt to the clipboard and flips a transient "copiado" flag for visual feedback.
export function useCopyPrompt(text: string, resetMs = 1800) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), resetMs)
    } catch {
      setCopied(false)
    }
  }

  return { copied, copy }
}
