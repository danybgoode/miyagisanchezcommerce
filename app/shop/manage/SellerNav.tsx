'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  SELLER_NAV,
  SELLER_NAV_MOBILE_PRIMARY,
  SELLER_NAV_MOBILE_OVERFLOW,
  activeSellerNavHref,
  type SellerNavEntry,
} from '@/lib/seller-nav'

// ── Desktop left rail ─────────────────────────────────────────────────────────
function RailItem({ entry, active }: { entry: SellerNavEntry; active: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 'var(--r-lg)',
        textDecoration: 'none',
        fontSize: 14,
        fontFamily: 'var(--font-sans)',
        color: active ? 'var(--accent-ink)' : 'var(--fg-muted)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        fontWeight: active ? 600 : 400,
      }}
    >
      <i className={entry.icon} style={{ fontSize: 18, lineHeight: 1 }} />
      {entry.label}
    </Link>
  )
}

// ── Mobile bottom-bar item ────────────────────────────────────────────────────
function BarItem({ entry, active }: { entry: SellerNavEntry; active: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-label={entry.label}
      aria-current={active ? 'page' : undefined}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        textDecoration: 'none',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        minWidth: 0,
      }}
    >
      <i className={entry.icon} style={{ fontSize: 20, lineHeight: 1 }} />
      <span style={{ fontSize: 10, fontFamily: 'var(--font-sans)' }}>{entry.label}</span>
    </Link>
  )
}

export default function SellerNav() {
  const pathname = usePathname() ?? ''
  const active = activeSellerNavHref(pathname)
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <>
      {/* ── Desktop left rail ── */}
      <nav
        className="hidden md:flex"
        aria-label="Navegación de vendedor"
        style={{
          flexDirection: 'column',
          gap: 18,
          width: 200,
          flexShrink: 0,
          position: 'sticky',
          top: 16,
          alignSelf: 'flex-start',
        }}
      >
        {SELLER_NAV.map(group => (
          <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--fg-subtle)',
                padding: '0 12px 2px',
              }}
            >
              {group.label}
            </span>
            {group.entries.map(entry => (
              <RailItem key={entry.key} entry={entry} active={entry.href === active} />
            ))}
          </div>
        ))}
      </nav>

      {/* ── Mobile bottom bar ── */}
      {/* "Más" overflow sheet — anchored above the bar. */}
      {moreOpen && (
        <>
          <button
            aria-label="Cerrar"
            onClick={() => setMoreOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99,
              border: 'none',
              background: 'transparent',
              cursor: 'default',
            }}
            className="flex md:hidden"
          />
          <div
            className="glass-liquid flex md:hidden"
            role="menu"
            style={{
              position: 'fixed',
              bottom: 'calc(80px + env(safe-area-inset-bottom))',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100% - 24px)',
              maxWidth: 480,
              zIndex: 100,
              flexDirection: 'column',
              padding: 8,
              borderRadius: 'var(--r-lg)',
              gap: 2,
            }}
          >
            {SELLER_NAV_MOBILE_OVERFLOW.map(entry => (
              <Link
                key={entry.key}
                href={entry.href}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
                aria-current={entry.href === active ? 'page' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-lg)',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontFamily: 'var(--font-sans)',
                  color: entry.href === active ? 'var(--accent-ink)' : 'var(--fg)',
                  background: entry.href === active ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <i className={entry.icon} style={{ fontSize: 18, lineHeight: 1 }} />
                {entry.label}
              </Link>
            ))}
          </div>
        </>
      )}

      <nav
        className="glass-liquid flex md:hidden"
        aria-label="Navegación de vendedor"
        style={{
          position: 'fixed',
          bottom: 'max(16px, env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 24px)',
          maxWidth: 480,
          height: 56,
          zIndex: 100,
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '0 4px',
          borderRadius: 28,
        }}
      >
        {SELLER_NAV_MOBILE_PRIMARY.map(entry => (
          <BarItem key={entry.key} entry={entry} active={entry.href === active} />
        ))}
        <button
          type="button"
          aria-label="Más"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: moreOpen ? 'var(--accent)' : 'var(--fg-muted)',
            minWidth: 0,
          }}
        >
          <i className="iconoir-menu" style={{ fontSize: 20, lineHeight: 1 }} />
          <span style={{ fontSize: 10, fontFamily: 'var(--font-sans)' }}>Más</span>
        </button>
      </nav>
    </>
  )
}
