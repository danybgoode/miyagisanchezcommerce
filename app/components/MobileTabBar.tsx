'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useRef } from 'react'
import {
  LABEL_MODE, shouldHideTabBar, nextTabBarHidden, type LabelMode,
} from '@/lib/tabbar-visibility'

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
        inset: 0,
        borderRadius: 10,
        background: 'var(--accent-soft)',
        opacity: active ? 1 : 0,
        transform: active ? 'scale(1)' : 'scale(0.65)',
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
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        textDecoration: 'none',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 10,
        fontWeight: active ? 600 : 500,
        padding: '4px 6px',
        borderRadius: 12,
        minWidth: 44,
        height: 48,
      }}
    >
      <ActivePill active={active} />
      <div style={{ position: 'relative' }}>
        <i className={icon} style={{ fontSize: 22, position: 'relative', zIndex: 1 }} />
        <UnreadDot show={!!hasUnread} />
      </div>
      {showLabel && <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>}
    </Link>
  )
}

export default function MobileTabBar() {
  const pathname = usePathname()
  const { isSignedIn } = useUser()

  const [hasUnread, setHasUnread] = useState(false)
  const [hidden, setHidden]       = useState(false)
  const lastY = useRef(0)

  // Poll unread count every 60s (lightweight count; in-conversation is realtime)
  useEffect(() => {
    if (!isSignedIn) { setHasUnread(false); return }
    let cancelled = false

    async function checkUnread() {
      try {
        const res = await fetch('/api/conversations/unread')
        const data = await res.json() as { unread: number }
        if (!cancelled) setHasUnread(data.unread > 0)
      } catch { /* silent */ }
    }

    checkUnread()
    const id = setInterval(checkUnread, 60_000)
    return () => { cancelled = true; clearInterval(id) }
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

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const profileHref  = isSignedIn ? '/account' : '/sign-in'
  const messagesHref = isSignedIn ? '/messages' : '/sign-in'

  return (
    <div
      className="pwa-only"
      style={{
        position: 'fixed',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        left: '50%',
        width: 'calc(100% - 24px)',
        maxWidth: 480,
        height: 56,
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
      {/* ── Main pill — Inicio · Explorar · ⊕ Vender · Mensajes · Cuenta ── */}
      <nav
        className="glass-liquid"
        style={{
          height: 56,
          borderRadius: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '0 4px',
        }}
      >
        {/* Inicio */}
        <TabItem
          href="/" icon="iconoir-home-simple" label="Inicio"
          active={isActive('/')} labelMode={LABEL_MODE}
        />

        {/* Explorar → listings */}
        <TabItem
          href="/l" icon="iconoir-search" label="Explorar"
          active={isActive('/l')} labelMode={LABEL_MODE}
        />

        {/* Center publish FAB → /sell */}
        <Link
          href="/sell"
          className="tab-press-center"
          aria-label="Vender"
          style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--fg-inverse)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
            flexShrink: 0,
            boxShadow: '0 4px 14px -4px rgba(29,111,66,0.55)',
          }}
        >
          <i className="iconoir-plus" style={{ fontSize: 20 }} />
        </Link>

        {/* Mensajes */}
        <TabItem
          href={messagesHref} icon="iconoir-chat-bubble" label="Mensajes"
          active={pathname.startsWith('/messages')}
          hasUnread={hasUnread && !pathname.startsWith('/messages')}
          labelMode={LABEL_MODE}
        />

        {/* Cuenta */}
        <TabItem
          href={profileHref}
          icon="iconoir-user"
          label={isSignedIn ? 'Cuenta' : 'Entrar'}
          active={isActive('/account') || isActive('/sign-in')}
          labelMode={LABEL_MODE}
        />
      </nav>
    </div>
  )
}
