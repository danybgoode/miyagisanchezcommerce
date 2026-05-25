'use client'

import { useState } from 'react'

const AGENT_PROMPT = `You are my personal shopping assistant for Miyagi Sánchez — Mexico's zero-commission marketplace.

Before helping me, please read both sources:
• Marketplace briefing (MCP endpoint, UCP capabilities, API docs): https://miyagisanchez.com/agent
• Universal Commerce Protocol spec: https://ucp.dev

Once you've reviewed them, you'll be able to search listings, make offers, and help me complete purchases or negotiations through the marketplace API. The marketplace supports physical goods, digital products, services, rentals, and subscriptions — all payable via Stripe, MercadoPago, or SPEI.

¿Qué estás buscando? / What are you looking for today?`

export default function AIAgentButton() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(AGENT_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(AGENT_PROMPT)}`

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="icon-btn"
        title="Comprar con IA / Buy with AI"
        style={{ color: 'var(--agent)' }}
      >
        <i className="iconoir-sparks" style={{ fontSize: 22 }} />
      </button>

      {open && (
        <>
          <div className="sheet-backdrop" onClick={() => setOpen(false)} />

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
              {AGENT_PROMPT}
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
        </>
      )}
    </>
  )
}
