'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_MENU_ITEMS } from '@/lib/account-menu'

/**
 * Cuenta hub — one dropdown holding every account action that used to be
 * scattered across the header (Mi tienda, Favoritos, Mi cuenta, theme, agent).
 *
 * Nav & Settings Reorg — Sprint 2. The item list + hrefs live in the pure
 * `lib/account-menu.ts` (covered by `e2e/account-menu.spec.ts`); this island
 * only renders them. The "Tema" row renders `themeSlot` — the server layout
 * passes the already-configured <PlatformThemeToggle> so this component needs
 * no theme-specific props (slot pattern).
 */
export default function CuentaMenu({ themeSlot }: { themeSlot: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside-click and Escape.
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Cuenta"
        title="Cuenta"
        onClick={() => setOpen(v => !v)}
        style={{ gap: 2 }}
      >
        <i className="iconoir-user" style={{ fontSize: 22 }} />
        <i
          className="iconoir-nav-arrow-down"
          aria-hidden
          style={{
            fontSize: 14,
            transition: 'transform var(--dur-fast) var(--ease-standard)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Cuenta"
          className="glass"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 232,
            borderRadius: 'var(--r-lg)',
            padding: 6,
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {ACCOUNT_MENU_ITEMS.map(item => {
            if (item.kind === 'theme') {
              return (
                <div
                  key={item.key}
                  role="menuitem"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 'var(--r-md)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <i className={item.icon} style={{ fontSize: 18, color: 'var(--fg-muted)' }} aria-hidden />
                    <span style={{ fontSize: 14, color: 'var(--fg)' }}>{item.label}</span>
                  </span>
                  {themeSlot}
                </div>
              )
            }
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="cuenta-menu-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 'var(--r-md)',
                  textDecoration: 'none',
                  color: 'var(--fg)',
                  fontSize: 14,
                }}
              >
                <i className={item.icon} style={{ fontSize: 18, color: 'var(--fg-muted)' }} aria-hidden />
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
