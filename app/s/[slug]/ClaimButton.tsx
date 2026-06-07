'use client'

import Link from 'next/link'

/**
 * Client component wrapper so onMouseOver/onMouseOut event handlers
 * don't crash the server component (RSC cannot serialize functions).
 */
export default function ClaimButton({ href, accent }: { href: string; accent: string }) {
  return (
    <Link
      href={href}
      className="inline-block text-sm border rounded px-3 py-1 no-underline transition-colors"
      style={{ color: accent, borderColor: accent }}
      onMouseOver={e => {
        const el = e.currentTarget as HTMLElement
        el.style.backgroundColor = accent
        el.style.color = 'var(--fg-inverse)'
      }}
      onMouseOut={e => {
        const el = e.currentTarget as HTMLElement
        el.style.backgroundColor = 'transparent'
        el.style.color = accent
      }}
    >
      ¿Es tu tienda? Reclamar →
    </Link>
  )
}
