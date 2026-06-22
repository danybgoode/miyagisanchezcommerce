'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useRef } from 'react'
import {
  LABEL_MODE, shouldHideTabBar, nextTabBarHidden,
  BOTTOM_TABS, resolveBottomTabHref, isBottomTabActive, type LabelMode,
} from '@/lib/tabbar-visibility'
import SearchSheet, { type SearchSheetCopy } from '@/app/components/SearchSheet'

// Badge dot for unread counts
function UnreadDot({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', top: 4, right: 6,
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--danger)', border: '1.5px solid var(--glass-fill-liquid)',
      }}
    />
  )
}

// ── Apple motion spec ────────────────────────────────────────────────────────
// SPRING  : entrance — slight overshoot, settles naturally (response ~0.38, damping ~0.72)
// EASE_OUT: exit — clean deceleration, never bounces out
const SPRING   = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

// ── Active tab background pill ───────────────────────────────────────────────
function ActivePill({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: '7px 0',                         // handoff .tab-btn.active::before
        borderRadius: 18,
        background: 'var(--glass-capsule-fill)', // brighter inner glass pane (light/dark tokenized)
        boxShadow: 'var(--glass-capsule-stroke)',
        opacity: active ? 1 : 0,
        transform: active ? 'scaleX(1) scaleY(1)' : 'scaleX(0.75) scaleY(0.8)',
        transition: `opacity 200ms ${EASE_OUT}, transform 300ms ${SPRING}`,
        pointerEvents: 'none',
      }}
    />
  )
}

// ── Single tab item ──────────────────────────────────────────────────────────
function TabItem({
  href, icon, label, active, hasUnread, labelMode,
}: {
  href: string
  icon: string
  label: string
  active: boolean
  hasUnread?: boolean
  labelMode: LabelMode
}) {
  // 'icons-only' → no visible text (aria-label carries the name);
  // 'active-label' → text on the active tab only; 'full-labels' → always.
  const showLabel =
    labelMode === 'full-labels' || (labelMode === 'active-label' && active)

  return (
    <Link
      href={href}
      className="tab-press"
      aria-label={label}
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        textDecoration: 'none',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 10,
        fontWeight: 600,
        padding: '0 6px',
        borderRadius: 24,
        minWidth: 44,
        height: '100%',
      }}
    >
      <ActivePill active={active} />
      <div style={{ position: 'relative' }}>
        <i
          className={icon}
          style={{
            fontSize: 22,
            position: 'relative',
            zIndex: 1,
            // Active icon lifts slightly (handoff .tab-btn.active .tab-icon).
            transform: active ? 'translateY(-1px)' : 'none',
            transition: `transform 200ms ${SPRING}`,
          }}
        />
        <UnreadDot show={!!hasUnread} />
      </div>
      {showLabel && <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>}
    </Link>
  )
}

export default function MobileTabBar({ search }: { search: SearchSheetCopy }) {
  const pathname = usePathname()
  const { isSignedIn } = useUser()

  const [hasUnread, setHasUnread] = useState(false)
  const [hidden, setHidden]       = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastY = useRef(0)

  // Poll unread count every 150s, but only while the tab is visible — a hidden/
  // backgrounded tab generates no invocations (in-conversation delivery is realtime;
  // this is just the global badge). Refetch immediately when the tab returns.
  useEffect(() => {
    if (!isSignedIn) { setHasUnread(false); return }
    let cancelled = false

    async function checkUnread() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/conversations/unread')
        const data = await res.json() as { unread: number }
        if (!cancelled) setHasUnread(data.unread > 0)
      } catch { /* silent */ }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') checkUnread()
    }

    checkUnread()
    const id = setInterval(checkUnread, 150_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isSignedIn])

  // Contextual hide — get out of the way of content and the keyboard.
  // (a) hide-on-scroll: translate off past an 8px down-delta, spring back up.
  // (b) keyboard auto-hide: the on-screen keyboard shrinks visualViewport vs
  //     layout height, so hide whenever that gap opens.
  useEffect(() => {
    lastY.current = window.scrollY

    function onScroll() {
      const y = window.scrollY
      setHidden(prev => nextTabBarHidden(lastY.current, y, prev))
      lastY.current = y
    }

    const vv = window.visualViewport
    function onViewport() {
      if (!vv) return
      // Keyboard up ⇒ visual viewport noticeably shorter than the layout viewport.
      const keyboardOpen = window.innerHeight - vv.height > 120
      if (keyboardOpen) setHidden(true)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    vv?.addEventListener('resize', onViewport)
    return () => {
      window.removeEventListener('scroll', onScroll)
      vv?.removeEventListener('resize', onViewport)
    }
  }, [])

  // Bar is removed entirely on full-screen flows (PDP / checkout / conversation / publish).
  if (shouldHideTabBar(pathname)) return null

  return (
    <>
    <div
      className="pwa-only"
      style={{
        position: 'fixed',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        left: '50%',
        width: 'calc(100% - 24px)',
        maxWidth: 480,
        height: 64,
        zIndex: 100,
        // Slide off-screen + fade when hidden (scroll-down / keyboard up).
        transform: hidden
          ? 'translateX(-50%) translateY(140%)'
          : 'translateX(-50%) translateY(0)',
        opacity: hidden ? 0 : 1,
        transition: hidden
          ? `transform 240ms ${EASE_OUT}, opacity 200ms ${EASE_OUT}`
          : `transform 320ms ${SPRING}, opacity 240ms ${EASE_OUT}`,
        pointerEvents: hidden ? 'none' : 'auto',
      }}
    >
      {/* Row: the main pill flexes to fill, the detached search circle sits to
          its right (mockup layout). Both glass surfaces ride the same hide
          transform on the wrapper above, so they slide/spring together. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 64,
          width: '100%',
        }}
      >
      {/* ── Main pill — Inicio · Mensajes · ⊕ Vender · Favoritos · Perfil ──
          Rendered from BOTTOM_TABS (lib/tabbar-visibility) so the set/order is
          the single source the api spec also reads. */}
      <nav
        className="glass-liquid"
        style={{
          flex: 1,
          minWidth: 0,
          height: 64,
          borderRadius: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 8px',
        }}
      >
        {BOTTOM_TABS.map(tab => {
          const href   = resolveBottomTabHref(tab, !!isSignedIn)
          const active = isBottomTabActive(tab.key, pathname)

          // Center publish FAB → /sell (the fattest, raised target).
          if (tab.kind === 'fab') {
            return (
              <Link
                key={tab.key}
                href={href}
                className="tab-press-center"
                aria-label={tab.label}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: 'var(--fg-inverse)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none',
                  flexShrink: 0,
                  // handoff .tab-fab
                  boxShadow: '0 4px 12px -2px rgba(29,111,66,0.50), inset 0 1px 0 rgba(255,255,255,0.2)',
                }}
              >
                <i className={tab.icon} style={{ fontSize: 24 }} />
              </Link>
            )
          }

          return (
            <TabItem
              key={tab.key}
              href={href}
              icon={tab.icon}
              label={tab.label}
              active={active}
              hasUnread={tab.unread ? hasUnread && !active : false}
              labelMode={LABEL_MODE}
            />
          )
        })}
      </nav>

        {/* Detached liquid-glass search control — opens the bottom-sheet search
            (S2.1). focus() runs SYNCHRONOUSLY in the tap handler so iOS raises the
            keyboard on the tap itself (WebKit bug 279904); the sheet's input is always
            mounted (sibling below), so the ref is live at tap time. */}
        <button
          type="button"
          onClick={() => { searchInputRef.current?.focus(); setSearchOpen(true) }}
          className="glass-liquid search-circle-btn"
          aria-label="Buscar"
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: 'none',
            cursor: 'pointer',
            color: 'var(--fg-muted)',
          }}
        >
          <i className="iconoir-search" style={{ fontSize: 22 }} />
        </button>
      </div>
      </div>

      {/* Bottom-sheet search — a SIBLING of the bar wrapper so it does NOT ride
          the bar's keyboard auto-hide transform when the field is focused. */}
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        inputRef={searchInputRef}
        copy={search}
      />
    </>
  )
}
