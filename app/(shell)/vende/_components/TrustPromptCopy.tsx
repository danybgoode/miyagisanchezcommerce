'use client'

import { useState } from 'react'

type TrustPromptCopyProps = {
  prompt: string
  copyLabel: string
  copiedLabel: string
  testId?: string
}

export function TrustPromptCopy({
  prompt,
  copyLabel,
  copiedLabel,
  testId,
}: TrustPromptCopyProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-agent btn-sm"
      onClick={handleCopy}
      data-testid={testId}
      style={{ flexShrink: 0 }}
    >
      <i className="iconoir-copy" aria-hidden="true" />
      {copied ? copiedLabel : copyLabel}
    </button>
  )
}
