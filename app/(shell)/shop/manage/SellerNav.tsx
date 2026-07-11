'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  SELLER_NAV,
  SELLER_NAV_MOBILE_PRIMARY,
  SELLER_NAV_MOBILE_OVERFLOW_GROUPS,
  activeSellerNavHref,
  filterNavByEnabledFlags,
  filterEntriesByEnabledFlags,
  hasRelayBadge,
  type SellerNavEntry,
} from '@/lib/seller-nav'
import type { FlagKey } from '@/lib/flags'
import { StatusBadge } from '@/components/ui/StatusBadge'

interface SellerNavProps {
  /** Server-resolved via `isEnabled()` in `layout.tsx` — never forked here. */
  enabledFlags?: ReadonlySet<FlagKey>
  /** Pending-count badges keyed by `SellerNavEntry.key` (today: `pedidos`, `ofertas`). */
  badges?: Readonly<Partial<Record<string, number>>>
  /** Shows a warning pill on the Configuración entry in the "Más" sheet when true. */
  configIncomplete?: boolean
  /** Backs the "Ver tienda pública" link in the "Más" sheet; omitted when no shop/user. */
  shopSlug?: string | null
}

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

// ── Mobile bottom-bar item (Resumen · Pedidos · Catálogo) ────────────────────
function BarItem({ entry, active, badgeCount }: { entry: SellerNavEntry; active: boolean; badgeCount?: number }) {
  return (
    <Link
      href={entry.href}
      aria-label={entry.label}
      aria-current={active ? 'page' : undefined}
      style={{
        flex: 1,
        position: 'relative',
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
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <i className={entry.icon} style={{ fontSize: 20, lineHeight: 1 }} />
        {!!badgeCount && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -4,
              right: -6,
              width: 7,
              height: 7,
              borderRadius: 'var(--r-pill)',
              background: 'var(--warning)',
              border: '1.5px solid var(--bg)',
            }}
          />
        )}
      </span>
      <span style={{ fontSize: 10, fontFamily: 'var(--font-sans)' }}>{entry.mobileLabel ?? entry.label}</span>
    </Link>
  )
}

// ── Center FAB — "Publicar" → /sell (F5, visual precedent: buyer MobileTabBar's /sell FAB) ──
function PublicarFab() {
  return (
    <Link
      href="/sell"
      aria-label="Publicar"
      style={{
        flexShrink: 0,
        width: 46,
        height: 46,
        marginTop: -20,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--accent)',
        color: 'var(--fg-inverse)',
        boxShadow: '0 4px 12px -2px rgba(29,111,66,0.50), inset 0 1px 0 rgba(255,255,255,0.2)',
        textDecoration: 'none',
      }}
    >
      <i className="iconoir-plus" style={{ fontSize: 24, lineHeight: 1 }} />
    </Link>
  )
}

// ── "Más" sheet — one leaf entry (list or grid cell) ─────────────────────────
function OverflowEntry({
  entry,
  active,
  onSelect,
  badgeCount,
  showConfigPill,
  layout,
}: {
  entry: SellerNavEntry
  active: boolean
  onSelect: () => void
  badgeCount?: number
  showConfigPill?: boolean
  layout: 'list' | 'grid'
}) {
  return (
    <Link
      href={entry.href}
      role="menuitem"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      style={
        layout === 'grid'
          ? {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '12px 8px',
              borderRadius: 'var(--r-lg)',
              textDecoration: 'none',
              fontSize: 12,
              textAlign: 'center',
              fontFamily: 'var(--font-sans)',
              color: active ? 'var(--accent-ink)' : 'var(--fg)',
              background: active ? 'var(--accent-soft)' : 'transparent',
            }
          : {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 'var(--r-lg)',
              textDecoration: 'none',
              fontSize: 14,
              fontFamily: 'var(--font-sans)',
              color: active ? 'var(--accent-ink)' : 'var(--fg)',
              background: active ? 'var(--accent-soft)' : 'transparent',
            }
      }
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className={entry.icon} style={{ fontSize: layout === 'grid' ? 22 : 18, lineHeight: 1 }} />
        {entry.label}
      </span>
      {!!badgeCount && <StatusBadge token="warning">{badgeCount}</StatusBadge>}
      {showConfigPill && <StatusBadge token="warning">Pendiente</StatusBadge>}
    </Link>
  )
}

export default function SellerNav({ enabledFlags = new Set(), badges = {}, configIncomplete = false, shopSlug = null }: SellerNavProps) {
  const pathname = usePathname() ?? ''
  const active = activeSellerNavHref(pathname)
  const [moreOpen, setMoreOpen] = useState(false)
  const railGroups = filterNavByEnabledFlags(SELLER_NAV, enabledFlags)
  const primaryEntries = filterEntriesByEnabledFlags(SELLER_NAV_MOBILE_PRIMARY, enabledFlags)
  const overflowGroups = filterNavByEnabledFlags(SELLER_NAV_MOBILE_OVERFLOW_GROUPS, enabledFlags)
  const relayActive = hasRelayBadge(overflowGroups, badges)

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
        {railGroups.map(group => (
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
      {/* "Más" overflow sheet — anchored above the bar, grouped with headers. */}
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
              maxHeight: 'calc(100vh - 160px)',
              overflowY: 'auto',
              zIndex: 100,
              flexDirection: 'column',
              padding: 8,
              borderRadius: 'var(--r-lg)',
              gap: 10,
            }}
          >
            {overflowGroups.map(group => (
              <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--fg-subtle)',
                    padding: '4px 12px 2px',
                  }}
                >
                  {group.label}
                </span>
                <div
                  style={
                    group.layout === 'grid'
                      ? { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }
                      : { display: 'flex', flexDirection: 'column', gap: 2 }
                  }
                >
                  {group.entries.map(entry => (
                    <OverflowEntry
                      key={entry.key}
                      entry={entry}
                      active={entry.href === active}
                      onSelect={() => setMoreOpen(false)}
                      badgeCount={badges[entry.key]}
                      showConfigPill={entry.key === 'ajustes' && configIncomplete}
                      layout={group.layout ?? 'list'}
                    />
                  ))}
                </div>
              </div>
            ))}
            {shopSlug && (
              <Link
                href={`/s/${shopSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMoreOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-lg)',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--accent)',
                }}
              >
                <i className="iconoir-open-new-window" style={{ fontSize: 16, lineHeight: 1 }} />
                Ver tienda pública
              </Link>
            )}
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
        {primaryEntries[0] && <BarItem entry={primaryEntries[0]} active={primaryEntries[0].href === active} />}
        {primaryEntries[1] && <BarItem entry={primaryEntries[1]} active={primaryEntries[1].href === active} badgeCount={badges[primaryEntries[1].key]} />}
        <PublicarFab />
        {primaryEntries[2] && <BarItem entry={primaryEntries[2]} active={primaryEntries[2].href === active} />}
        <button
          type="button"
          aria-label="Más"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
          style={{
            flex: 1,
            position: 'relative',
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
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <i className="iconoir-menu" style={{ fontSize: 20, lineHeight: 1 }} />
            {relayActive && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  width: 7,
                  height: 7,
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--info)',
                  border: '1.5px solid var(--bg)',
                }}
              />
            )}
          </span>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-sans)' }}>Más</span>
        </button>
      </nav>
    </>
  )
}
