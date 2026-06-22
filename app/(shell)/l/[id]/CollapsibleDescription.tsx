'use client'

import { useState } from 'react'

/**
 * CollapsibleDescription — PDP redesign (epic 01) Sprint 1, S1.2.
 *
 * In the reordered PDP the description moves *above* the payment/seller blocks on
 * mobile (so the buyer understands the item before being asked to act). To keep the
 * payment box from being pushed far down by a long description, a long one clamps to
 * a few lines with a "Ver más" / "Ver menos" toggle. Short descriptions render in
 * full with no toggle.
 *
 * The clamp uses an inline `display: -webkit-box` on the inner `<p>` only — never on
 * an element toggled by `md:hidden`/`hidden md:block` (the duplicate-render
 * inline-style trap in LEARNINGS); the mobile/desktop visibility is owned by the
 * wrapper's class in the page.
 */
const CLAMP_THRESHOLD = 280

export default function CollapsibleDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > CLAMP_THRESHOLD

  return (
    <div>
      <p
        style={{
          fontSize: 14,
          color: 'var(--fg)',
          lineHeight: 1.6,
          whiteSpace: 'pre-line',
          ...(isLong && !expanded
            ? { display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            : {}),
        }}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 6,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--accent)',
          }}
        >
          {expanded ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  )
}
