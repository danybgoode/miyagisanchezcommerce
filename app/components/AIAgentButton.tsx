'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { buildAgentPrompt, resolveAgentContext } from '@/lib/agent-prompt'

/**
 * `icon`       — bare ✨ icon button (legacy; no longer mounted after the
 *                Nav & Settings Reorg one-agent-entry cleanup).
 * `affordance` — a labeled "Agente IA" pill (sparks + text), the single agent
 *                entry that sits inline with the centered desktop search.
 * `search`     — a compact sparks button, absolutely pinned to the right edge of
 *                a `position:relative` search input (mobile header). Same sheet.
 */
type Variant = 'icon' | 'affordance' | 'search'

export default function AIAgentButton({ variant = 'icon' }: { variant?: Variant } = {}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // es-MX hand-off prompt, contextual to the current page (URL-only — S1.3).
  // `usePathname` is SSR-safe + Suspense-free (so static pages stay static); the
  // catalog query string is read from `window` only after mount — the sheet opens
  // on click, so the copied/opened prompt always reflects the live URL.
  const pathname = usePathname()
  const searchParams = mounted && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null
  const prompt = buildAgentPrompt(resolveAgentContext(pathname, searchParams))

  async function copy() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

  const sheet = open && mounted ? createPortal(
    <>
      {/* Backdrop — rendered directly in <body>, escapes backdrop-filter stacking context */}
      <div
        className="sheet-backdrop"
        onClick={() => setOpen(false)}
      />

      <div className="sheet-panel">
        {/* Handle bar */}
        <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 'var(--r-md)',
            background: 'var(--agent-soft)', color: 'var(--agent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <i className="iconoir-sparks" style={{ fontSize: 22 }} />
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--fg)', margin: 0, lineHeight: 1.2 }}>
              Compra con tu agente IA
            </p>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: '4px 0 0', lineHeight: 1.4 }}>
              Copia este prompt en Claude, ChatGPT o Gemini.
            </p>
          </div>
        </div>

        {/* Prompt box */}
        <div style={{
          background: 'var(--bg-sunk)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: '12px 14px',
          fontSize: 12,
          color: 'var(--fg)',
          lineHeight: 1.6,
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap',
          marginBottom: 14,
          maxHeight: 160,
          overflowY: 'auto',
        }}>
          {prompt}
        </div>

        {/* Primary actions */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={copy}
            className="btn btn-primary"
            style={{ flex: 1, fontSize: 14, gap: 6 }}
          >
            <i className={copied ? 'iconoir-check' : 'iconoir-copy'} style={{ fontSize: 16 }} />
            {copied ? '¡Copiado!' : 'Copiar prompt'}
          </button>
          <a
            href={claudeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-agent"
            style={{ flex: 1, fontSize: 14, gap: 6 }}
          >
            <i className="iconoir-open-in-browser" style={{ fontSize: 16 }} />
            Abrir en Claude
          </a>
        </div>

        {/* Secondary links */}
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="/agent"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, fontSize: 13 }}
          >
            <i className="iconoir-book" style={{ fontSize: 14 }} />
            Ficha del marketplace
          </a>
          <a
            href="https://ucp.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, fontSize: 13 }}
          >
            <i className="iconoir-globe" style={{ fontSize: 14 }} />
            ucp.dev
          </a>
        </div>
      </div>
    </>,
    document.body
  ) : null

  return (
    <>
      {variant === 'search' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Comprar con IA"
          aria-label="Agente IA"
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--agent)',
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          <i className="iconoir-sparks" style={{ fontSize: 17 }} />
        </button>
      ) : variant === 'affordance' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Comprar con IA / Buy with AI"
          aria-label="Agente IA"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 34,
            padding: '0 12px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--agent-soft)',
            color: 'var(--agent)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <i className="iconoir-sparks" style={{ fontSize: 16 }} />
          Agente IA
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="icon-btn"
          title="Comprar con IA / Buy with AI"
          style={{ color: 'var(--agent)' }}
        >
          <i className="iconoir-sparks" style={{ fontSize: 22 }} />
        </button>
      )}
      {sheet}
    </>
  )
}
