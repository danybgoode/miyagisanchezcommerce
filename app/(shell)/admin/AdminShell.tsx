'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ADMIN_SECTIONS,
  ADMIN_SECTION_GROUP_LABELS,
  activeAdminSectionHref,
  type AdminSection,
  type AdminSectionGroup,
} from '@/lib/admin/sections'

/**
 * Admin shell — the left-nav chrome rendered around every `/admin/*` page from
 * the `ADMIN_SECTIONS` registry. Presentational only (no auth — the per-page
 * guards own that). External sections open the linked app in a new tab. Modeled
 * on `app/(shell)/shop/manage/SellerNav.tsx`; icons are global Iconoir classes.
 *
 * Sprint 3 · Story 3.3: sections render under `General`/`Sitio`/`Administración`
 * group headers (`AdminSection.group`); the desktop rail's sticky container
 * gained an internal scroll (`maxHeight` + `overflowY: 'auto'`) — it was
 * already `position: sticky` but had no height bound, so once the nav grew
 * taller than the viewport it just overflowed downward with the page instead
 * of scrolling in place. The mobile horizontal nav now uses the shared
 * `.chip`/`.chip-rail` primitives instead of a bespoke local style object.
 */

const GROUP_ORDER: readonly AdminSectionGroup[] = ['general', 'sitio', 'administracion']

const GROUPED_SECTIONS = GROUP_ORDER.map((group) => ({
  group,
  label: ADMIN_SECTION_GROUP_LABELS[group],
  sections: ADMIN_SECTIONS.filter((s) => s.group === group),
})).filter((g) => g.sections.length > 0)

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
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
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
        {GROUPED_SECTIONS.map(({ group, label, sections }) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <div
              style={{
                padding: '6px 12px 4px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--fg-subtle)',
              }}
            >
              {label}
            </div>
            {sections.map((section) => (
              <NavItem key={section.key} section={section} active={section.href === active} />
            ))}
          </div>
        ))}
      </nav>

      {/* ── Mobile horizontal nav ── */}
      <nav
        className="chip-rail flex md:hidden"
        aria-label="Navegación de administración"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          padding: '8px 12px',
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link href="/admin" className="chip" style={{ fontWeight: 700 }}>
          Admin
        </Link>
        {ADMIN_SECTIONS.map(section =>
          section.external ? (
            <a key={section.key} href={section.href} target="_blank" rel="noopener noreferrer" className="chip">
              {section.label} ↗
            </a>
          ) : (
            <Link
              key={section.key}
              href={section.href}
              aria-current={section.href === active ? 'page' : undefined}
              className={`chip${section.href === active ? ' is-selected' : ''}`}
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
