'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ADMIN_SECTIONS, activeAdminSectionHref, type AdminSection } from '@/lib/admin/sections'

/**
 * Admin shell — the left-nav chrome rendered around every `/admin/*` page from
 * the `ADMIN_SECTIONS` registry. Presentational only (no auth — the per-page
 * guards own that). External sections open the linked app in a new tab. Modeled
 * on `app/(shell)/shop/manage/SellerNav.tsx`; icons are global Iconoir classes.
 */

function NavItem({ section, active }: { section: AdminSection; active: boolean }) {
  const common = {
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
  } as const

  if (section.external) {
    return (
      <a href={section.href} target="_blank" rel="noopener noreferrer" style={common}>
        <i className={section.icon} style={{ fontSize: 18, lineHeight: 1 }} />
        <span style={{ flex: 1 }}>{section.label}</span>
        <i className="iconoir-arrow-up-right" style={{ fontSize: 14, lineHeight: 1, opacity: 0.7 }} />
      </a>
    )
  }
  return (
    <Link href={section.href} aria-current={active ? 'page' : undefined} style={common}>
      <i className={section.icon} style={{ fontSize: 18, lineHeight: 1 }} />
      {section.label}
    </Link>
  )
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const active = activeAdminSectionHref(pathname)

  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        maxWidth: 1200,
        margin: '0 auto',
        padding: '24px 16px',
        alignItems: 'flex-start',
      }}
    >
      {/* ── Desktop left rail ── */}
      <nav
        className="hidden md:flex"
        aria-label="Navegación de administración"
        style={{
          flexDirection: 'column',
          gap: 4,
          width: 220,
          flexShrink: 0,
          position: 'sticky',
          top: 16,
          alignSelf: 'flex-start',
        }}
      >
        <Link
          href="/admin"
          aria-current={pathname === '/admin' ? 'page' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px 10px',
            textDecoration: 'none',
            color: 'var(--fg)',
            fontWeight: 700,
            fontSize: 15,
            fontFamily: 'var(--font-sans)',
          }}
        >
          <i className="iconoir-shield-alert" style={{ fontSize: 18, lineHeight: 1 }} />
          Admin
        </Link>
        {ADMIN_SECTIONS.map(section => (
          <NavItem key={section.key} section={section} active={section.href === active} />
        ))}
      </nav>

      {/* ── Mobile horizontal nav ── */}
      <nav
        className="flex md:hidden"
        aria-label="Navegación de administración"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          gap: 6,
          padding: '8px 12px',
          overflowX: 'auto',
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link href="/admin" style={{ ...chipStyle, fontWeight: 700 }}>
          Admin
        </Link>
        {ADMIN_SECTIONS.map(section =>
          section.external ? (
            <a key={section.key} href={section.href} target="_blank" rel="noopener noreferrer" style={chipStyle}>
              {section.label} ↗
            </a>
          ) : (
            <Link
              key={section.key}
              href={section.href}
              aria-current={section.href === active ? 'page' : undefined}
              style={{
                ...chipStyle,
                color: section.href === active ? 'var(--accent-ink)' : 'var(--fg-muted)',
                background: section.href === active ? 'var(--accent-soft)' : 'var(--surface-muted)',
              }}
            >
              {section.label}
            </Link>
          ),
        )}
      </nav>

      {/* ── Content ── */}
      <main style={{ flex: 1, minWidth: 0 }} className="pt-14 md:pt-0">
        {children}
      </main>
    </div>
  )
}

const chipStyle = {
  whiteSpace: 'nowrap',
  padding: '6px 12px',
  borderRadius: 999,
  textDecoration: 'none',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  color: 'var(--fg-muted)',
  background: 'var(--surface-muted)',
} as const
