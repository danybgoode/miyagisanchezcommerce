'use client'

import { useId, useState } from 'react'

/**
 * Living Shop — an expandable post body (epic 07, Story 2.2).
 *
 * The one client island in a Wall card. Everything else is server-rendered, so a
 * shop with twelve product cards ships no JavaScript for them.
 *
 * Accessible expansion, not a CSS-only clamp trick: the button is a real button,
 * it names what it controls with `aria-controls`/`aria-expanded`, and the FULL
 * text is always in the DOM so a screen reader and a search engine both get the
 * whole post regardless of the visual clamp.
 *
 * Copy arrives as props because the parent is a server component holding the
 * dictionary — the buyer copy population guard fails on any literal here.
 */

const CLAMP_THRESHOLD = 280

export default function WallPostBody({ body, more, less }: { body: string; more: string; less: string }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const long = body.length > CLAMP_THRESHOLD

  return (
    <div>
      <p
        id={id}
        className={`text-sm leading-relaxed whitespace-pre-wrap m-0 ${long && !expanded ? 'line-clamp-5' : ''}`}
      >
        {body}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-sm font-medium underline underline-offset-2"
          style={{ color: 'var(--shop-accent)' }}
        >
          {expanded ? less : more}
        </button>
      )}
    </div>
  )
}
