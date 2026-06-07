'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useRef, Suspense } from 'react'

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
  href, icon, label, active, exitDelay, enterDelay, collapsed, hasUnread,
}: {
  href: string
  icon: string
  label: string
  active: boolean
  exitDelay: number
  enterDelay: number
  collapsed: boolean
  hasUnread?: boolean
}) {
  return (
    <Link
      href={href}
      className="tab-press"
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
        // Staggered collapse / expand
        opacity: collapsed ? 0 : 1,
        transform: collapsed
          ? 'scale(0.78) translateY(4px)'
          : 'scale(1) translateY(0)',
        transition: collapsed
          ? `opacity 140ms ${EASE_OUT} ${exitDelay}ms, transform 160ms ${EASE_OUT} ${exitDelay}ms`
          : `opacity 220ms ${SPRING} ${enterDelay}ms, transform 280ms ${SPRING} ${enterDelay}ms`,
      }}
    >
      <ActivePill active={active} />
      <div style={{ position: 'relative' }}>
        <i className={icon} style={{ fontSize: 22, position: 'relative', zIndex: 1 }} />
        <UnreadDot show={!!hasUnread} />
      </div>
      <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
    </Link>
  )
}

// ── Inner component — uses hooks that need Suspense ──────────────────────────
function TabBarInner() {
  const pathname    = usePathname()
  const searchParams = useSearchParams()
  const router      = useRouter()
  const { isSignedIn } = useUser()

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery]           = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [hasUnread, setHasUnread]   = useState(false)

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

  // Sync search state from URL (?q= on /l page)
  const urlQuery = pathname === '/l' ? (searchParams.get('q') ?? '') : ''
  useEffect(() => {
    if (urlQuery) {
      setQuery(urlQuery)
      setSearchOpen(true)
    } else if (pathname !== '/l') {
      setSearchOpen(false)
      setQuery('')
    }
  }, [urlQuery, pathname])

  // NOTE: focus() is called synchronously in the search circle's onClick handler.
  // iOS only opens the keyboard when focus() is triggered inside the original
  // user gesture. A setTimeout() breaks the gesture chain → no keyboard.

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/l?q=${encodeURIComponent(q)}` : '/l')
  }

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
    if (pathname.startsWith('/l')) router.push('/l')
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const profileHref  = isSignedIn ? '/account' : '/sign-in'
  const messagesHref = isSignedIn ? '/messages' : '/sign-in'
  const favHref      = isSignedIn ? '/account/favorites' : '/l'

  return (
    <div
      className="pwa-only"
      style={{
        position: 'fixed',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 24px)',
        maxWidth: 480,
        height: 56,
        zIndex: 100,
      }}
    >

      {/* ════════════════════════════════════════════════════════════════════
          STATE A — Normal: pill (4 tabs) + detached search circle
          Exits with ease-out sink; enters right→left cascade
          ════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          // The whole layer fades + sinks on exit
          opacity: searchOpen ? 0 : 1,
          transform: searchOpen
            ? 'scale(0.95) translateY(5px)'
            : 'scale(1) translateY(0)',
          transition: searchOpen
            ? `opacity 200ms ${EASE_OUT}, transform 250ms ${EASE_OUT}`
            : `opacity 280ms ${EASE_OUT} 30ms, transform 320ms ${SPRING} 30ms`,
          pointerEvents: searchOpen ? 'none' : 'auto',
        }}
      >
        {/* ── Main pill ── */}
        <nav
          className="glass-liquid"
          style={{
            flex: 1,
            height: 56,
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: '0 4px',
          }}
        >
          {/* Tab 0 — Inicio (exits first, enters last) */}
          <TabItem
            href="/" icon="iconoir-home-simple" label="Inicio"
            active={isActive('/')}
            exitDelay={0} enterDelay={105} collapsed={searchOpen}
          />

          {/* Tab 1 — Mensajes */}
          <TabItem
            href={messagesHref} icon="iconoir-chat-bubble" label="Mensajes"
            active={pathname.startsWith('/messages')}
            exitDelay={20} enterDelay={70} collapsed={searchOpen}
            hasUnread={hasUnread && !pathname.startsWith('/messages')}
          />

          {/* Center + publish — own spring timing */}
          <Link
            href="/sell"
            className="tab-press-center"
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
              opacity: searchOpen ? 0 : 1,
              transform: searchOpen ? 'scale(0.68)' : 'scale(1)',
              transition: searchOpen
                ? `opacity 120ms ${EASE_OUT} 15ms, transform 150ms ${EASE_OUT} 15ms`
                : `opacity 240ms ${SPRING} 45ms, transform 300ms ${SPRING} 45ms`,
            }}
          >
            <i className="iconoir-plus" style={{ fontSize: 20 }} />
          </Link>

          {/* Tab 2 — Favoritos */}
          <TabItem
            href={favHref} icon="iconoir-heart" label="Favoritos"
            active={pathname.startsWith('/account/favorites')}
            exitDelay={70} enterDelay={20} collapsed={searchOpen}
          />

          {/* Tab 3 — Perfil (exits last, enters first) */}
          <TabItem
            href={profileHref}
            icon="iconoir-user"
            label={isSignedIn ? 'Perfil' : 'Entrar'}
            active={(isActive('/account') && !pathname.startsWith('/account/favorites')) || isActive('/sign-in')}
            exitDelay={105} enterDelay={0} collapsed={searchOpen}
          />
        </nav>

        {/* ── Detached search circle ── */}
        <button
          onClick={() => {
            setSearchOpen(true)
            // Synchronous focus within the user gesture — the only way iOS
            // will surface the keyboard. The input lives in the DOM at all
            // times (just hidden via opacity/pointerEvents) so focus() works
            // even before the open animation begins.
            inputRef.current?.focus()
          }}
          className="glass-liquid search-circle-btn"
          aria-label="Buscar"
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fg)',
            flexShrink: 0,
          }}
        >
          <i className="iconoir-search" style={{ fontSize: 22 }} />
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STATE B — Search: full-width morphed bar
          Enters with spring overshoot; exits with ease-out sink
          Content inside staggered: home → input → ✕
          ════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: searchOpen ? 1 : 0,
          transform: searchOpen
            ? 'scale(1) translateY(0)'
            : 'scale(0.96) translateY(8px)',
          transition: searchOpen
            ? `opacity 220ms ${EASE_OUT}, transform 340ms ${SPRING}`
            : `opacity 170ms ${EASE_OUT} 10ms, transform 210ms ${EASE_OUT} 10ms`,
          pointerEvents: searchOpen ? 'auto' : 'none',
        }}
      >
        <form
          onSubmit={handleSubmit}
          className="glass-liquid"
          style={{
            width: '100%',
            height: 56,
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            gap: 4,
          }}
        >
          {/* 🏠 home — springs in first */}
          <Link
            href="/"
            tabIndex={-1}
            onClick={() => { setSearchOpen(false); setQuery('') }}
            aria-label="Volver al inicio"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--fg-muted)',
              textDecoration: 'none',
              flexShrink: 0,
              opacity: searchOpen ? 1 : 0,
              transform: searchOpen ? 'scale(1)' : 'scale(0.6)',
              transition: searchOpen
                ? `opacity 180ms ${EASE_OUT} 55ms, transform 300ms ${SPRING} 55ms`
                : `opacity 110ms ${EASE_OUT}, transform 140ms ${EASE_OUT}`,
            }}
          >
            <i className="iconoir-home-simple" style={{ fontSize: 20 }} />
          </Link>

          {/* 🔍 icon + input — slides in from left */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              opacity: searchOpen ? 1 : 0,
              transform: searchOpen ? 'translateX(0)' : 'translateX(-10px)',
              transition: searchOpen
                ? `opacity 180ms ${EASE_OUT} 75ms, transform 280ms ${SPRING} 75ms`
                : `opacity 100ms ${EASE_OUT}, transform 130ms ${EASE_OUT}`,
            }}
          >
            <i
              className="iconoir-search"
              style={{ fontSize: 15, color: 'var(--fg-subtle)', flexShrink: 0 }}
            />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              tabIndex={searchOpen ? 0 : -1}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="¿Qué estás buscando?"
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                // 16px minimum — anything smaller triggers iOS auto-zoom on focus
                fontSize: 16,
                fontFamily: 'var(--font-sans)',
                color: 'var(--fg)',
                minWidth: 0,
              }}
            />
          </div>

          {/* ✕ close — springs in last, pops with overshoot */}
          <button
            type="button"
            tabIndex={-1}
            onClick={closeSearch}
            aria-label="Cerrar búsqueda"
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(26,26,24,0.08)',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              color: 'var(--fg-muted)',
              opacity: searchOpen ? 1 : 0,
              transform: searchOpen ? 'scale(1)' : 'scale(0.55)',
              transition: searchOpen
                ? `opacity 150ms ${EASE_OUT} 100ms, transform 300ms ${SPRING} 100ms`
                : `opacity 90ms ${EASE_OUT}, transform 120ms ${EASE_OUT}`,
            }}
          >
            <i className="iconoir-xmark" style={{ fontSize: 16 }} />
          </button>
        </form>
      </div>

    </div>
  )
}

// Suspense boundary required by useSearchParams
export default function MobileTabBar() {
  return (
    <Suspense fallback={null}>
      <TabBarInner />
    </Suspense>
  )
}
