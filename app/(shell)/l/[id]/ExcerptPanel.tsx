'use client'

/**
 * ExcerptPanel — the inline "Lee un adelanto" reader (bookshop launchpad S2.1).
 *
 * A collapsible free text sample shown on a digital listing's PDP. Text-only by
 * decision — no pdf.js, no images, no network — so it's byte-identical and
 * instant on mobile data. **Channel-agnostic on purpose**: it reads no channel
 * header and takes pure props, so it renders the same on the marketplace and on
 * a white-label storefront (there's no anonymous white-label PDP surface to
 * smoke-test the difference — see LEARNINGS). The full file stays private; this
 * is only the sample the seller pasted into the listing.
 */

import { useState } from 'react'

export default function ExcerptPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div data-testid="pdp-excerpt" style={{ marginBottom: 20 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          background: 'var(--agent-soft)',
          border: 'none',
          borderRadius: 'var(--r-lg)',
          padding: 16,
          cursor: 'pointer',
        }}
      >
        <i className="iconoir-book" style={{ fontSize: 20, color: 'var(--agent)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: 'var(--agent)' }}>
            Lee un adelanto
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
            Un fragmento gratuito antes de comprar
          </span>
        </span>
        <i
          className={open ? 'iconoir-nav-arrow-up' : 'iconoir-nav-arrow-down'}
          style={{ fontSize: 20, color: 'var(--fg-muted)', flexShrink: 0 }}
        />
      </button>

      {open && (
        <div
          style={{
            background: 'var(--bg-sunk)',
            borderRadius: 'var(--r-lg)',
            padding: 16,
            marginTop: 8,
            fontSize: 15,
            lineHeight: 1.7,
            color: 'var(--fg)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {text}
        </div>
      )}
    </div>
  )
}
