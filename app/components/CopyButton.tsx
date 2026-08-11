'use client'

import { BuyerCopyText, useBuyerCopy } from '@/app/components/BuyerPresentationContext'
import { useState } from 'react'

/** Small inline copy-to-clipboard button with a brief "✓ Copiado" confirmation. */
export default function CopyButton({ value, className }: { value: string; className?: string }) {
  const buyerCopy = useBuyerCopy()
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={buyerCopy('components.CopyButton.ebf7f2a9')}
      className={className ?? 'text-xs font-semibold text-[var(--color-accent)] border border-[var(--color-border)] rounded px-2 py-0.5'}
    >
      {copied ? <><i className="iconoir-check" aria-hidden /> <BuyerCopyText copyKey="components.CopyButton.7d0cba93" /></> : <BuyerCopyText copyKey="components.CopyButton.ebf7f2a9" />}
    </button>
  )
}
