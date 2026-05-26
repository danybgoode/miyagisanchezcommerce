'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, useRef, Suspense } from 'react'

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
  href, icon, label, active, exitDelay, enterDelay, collapsed,
}: {
  href: string
  icon: string
  label: string
  active: boolean
  exitDelay: number   // ms — delay when tab bar hides (left→right cascade)
  enterDelay: number  // ms — delay when tab bar appears (right→left cascade)
  collapsed: boolean  // true while search mode is open
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
        padding: '4px 8px',
        borderRadius: 12,
        minWidth: 48,
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
      <i className={icon} style={{ fontSize: 22, position: 'relative', zIndex: 1 }} />
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

  // Focus input after spring animation has had a moment to start
  useEffect(() => {
    if (!searchOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 90)
    return () => clearTimeout(t)
  }, [searchOpen])

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

  const profileHref = isSignedIn ? '/account' : '/sign-in'

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
            exitDelay={0} enterDelay={90} collapsed={searchOpen}
          />

          {/* Tab 1 — Favoritos */}
          <TabItem
            href="/l" icon="iconoir-heart" label="Favoritos"
            active={pathname === '/l'}
            exitDelay={30} enterDelay={60} collapsed={searchOpen}
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
              color: '#fff',
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

          {/* Tab 3 — Perfil (exits last, enters first) */}
          <TabItem
            href={profileHref}
            icon="iconoir-user"
            label={isSignedIn ? 'Perfil' : 'Entrar'}
            active={isActive('/account') || isActive('/sign-in')}
            exitDelay={90} enterDelay={0} collapsed={searchOpen}
          />
        </nav>

        {/* ── Detached search circle ── */}
        <button
          onClick={() => setSearchOpen(true)}
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
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="¿Qué estás buscando?"
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 14,
                fontFamily: 'var(--font-sans)',
                color: 'var(--fg)',
                minWidth: 0,
              }}
            />
          </div>

          {/* ✕ close — springs in last, pops with overshoot */}
          <button
            type="button"
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
