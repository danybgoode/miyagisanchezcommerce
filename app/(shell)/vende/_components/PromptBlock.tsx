'use client'

import { useCopyPrompt } from './useCopyPrompt'

type PromptBlockProps = {
  prompt: string
  copyLabel: string
  copiedLabel: string
  testId?: string
}

// The focal hero element (and the "Cómo funciona" aside): renders the per-page directive prompt as
// VISIBLE text in a sunk/bordered block, with a copy-icon button. The prompt is in the SSR HTML so an
// `api` spec can assert it without a browser; the copy interaction is exercised by the browser project.
export function PromptBlock({ prompt, copyLabel, copiedLabel, testId }: PromptBlockProps) {
  const { copied, copy } = useCopyPrompt(prompt)

  return (
    <div
      className="card-panel"
      style={{
        display: 'grid',
        gap: 'var(--s-4)',
        padding: 'var(--s-5)',
        background: 'var(--agent-soft)',
        border: '1px solid var(--anil-100)',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', color: 'var(--agent)' }}>
        <i className="iconoir-sparks" aria-hidden="true" />
        <span className="t-caption" style={{ fontWeight: 600, letterSpacing: 0 }}>
          {copyLabel}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          color: 'var(--fg)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: 'var(--s-4)',
          lineHeight: 1.55,
          fontSize: 14,
          overflowWrap: 'break-word',
        }}
      >
        {prompt}
      </p>
      <button
        type="button"
        className="btn btn-agent btn-sm"
        onClick={copy}
        data-testid={testId}
        aria-live="polite"
        style={{ justifySelf: 'start' }}
      >
        <i className="iconoir-copy" aria-hidden="true" />
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}
