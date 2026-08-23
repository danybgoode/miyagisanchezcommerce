'use client'

import Link from 'next/link'
import { useId, useRef, useState, useSyncExternalStore } from 'react'
import { ACCOUNT_MENU_ITEMS } from '@/lib/account-menu'

const subscribeToBrowser = () => () => {}

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
export default function CuentaMenu({
  themeSlot,
  themeEligible,
  accountLabel,
  itemLabels,
  hideFavoritesInPwa = false,
}: {
  themeSlot: React.ReactNode
  accountLabel: string
  itemLabels: Record<string, string>
  /**
   * Whether the platform theme toggle applies on this surface. When false the
   * toggle itself renders `null`, so we skip the whole Tema row rather than
   * leave an orphan label with no control — matches the toggle's prior
   * "absent where it doesn't work" behavior.
   */
  themeEligible: boolean
  /**
   * Drop the Favoritos row in the installed PWA standalone bar (where the bottom
   * tab now carries it — PWA Liquid-Glass Nav Polish S1.1). The row is tagged
   * `.pwa-hidden` (a CSS-only hide under `display-mode: standalone`), so it stays
   * visible on desktop and mobile web. Pass `true` on the mobile-header instance
   * only; the desktop instance leaves it default (there is no bottom tab there).
   */
  hideFavoritesInPwa?: boolean
}) {
  const [open, setOpen] = useState(false)
  const reactId = useId()
  // Both responsive header layouts remain mounted. A per-instance id and
  // anchor prevent the desktop trigger from controlling the hidden mobile menu.
  const menuId = `cuenta-menu-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const anchorName = `--${menuId}`
  const menuRef = useRef<HTMLDivElement>(null)
  const supportsPopover = useSyncExternalStore(
    subscribeToBrowser,
    () => 'showPopover' in HTMLElement.prototype,
    () => false,
  )
  const closeMenu = () => {
    if (supportsPopover) menuRef.current?.hidePopover()
    else setOpen(false)
  }

  return (
    <div
      style={{ position: 'relative', '--cuenta-menu-anchor': anchorName } as React.CSSProperties}
      onKeyDown={(event) => {
        if (supportsPopover === false && event.key === 'Escape') setOpen(false)
      }}
      onBlur={(event) => {
        if (supportsPopover === false && (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget))) setOpen(false)
      }}
    >
      <button
        type="button"
        popoverTarget={supportsPopover ? menuId : undefined}
        className="icon-btn cuenta-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accountLabel}
        title={accountLabel}
        onClick={() => {
          if (supportsPopover === false) setOpen(value => !value)
        }}
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

      <div
        ref={menuRef}
        id={menuId}
        popover={supportsPopover ? 'auto' : undefined}
        onToggle={(event) => setOpen(event.newState === 'open')}
        role="menu"
        aria-label={accountLabel}
        className="glass cuenta-menu-popover"
        style={{
          // D15: this fallback remains valid without CSS anchor support;
          // supported browsers progressively position it from the trigger.
          position: 'fixed',
          top: 56, // header height
          right: 12, // viewport edge margin
          minWidth: 232,
          borderRadius: 'var(--r-lg)',
          padding: 6,
          zIndex: 60,
          // A native popover is hidden by the UA while closed. Do not override
          // that with inline display, or both responsive menu instances show.
          display: supportsPopover ? undefined : open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {ACCOUNT_MENU_ITEMS.map(item => {
            if (item.kind === 'theme') {
              // Skip the row entirely where the toggle can't apply (it would
              // render null → an orphan "Tema" label with no control).
              if (!themeEligible) return null
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
                    <span style={{ fontSize: 14, color: 'var(--fg)' }}>{itemLabels[item.key]}</span>
                  </span>
                  {themeSlot}
                </div>
              )
            }
            // The bottom PWA tab carries Favoritos in standalone → hide the dup
            // row there (CSS-only; stays on desktop + mobile web).
            const pwaHidden = hideFavoritesInPwa && item.key === 'favorites'
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                onClick={closeMenu}
                className={pwaHidden ? 'cuenta-menu-item pwa-hidden' : 'cuenta-menu-item'}
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
                {itemLabels[item.key]}
              </Link>
            )
          })}
      </div>
    </div>
  )
}
