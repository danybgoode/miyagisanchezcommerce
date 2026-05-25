'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useState, useEffect, Suspense } from 'react'

const LIQUID_GLASS: React.CSSProperties = {
  background: 'rgba(249,249,247,0.80)',
  WebkitBackdropFilter: 'blur(32px) saturate(200%) brightness(1.05)',
  backdropFilter: 'blur(32px) saturate(200%) brightness(1.05)',
  boxShadow:
    'inset 0 1.5px 0 rgba(255,255,255,0.72), inset 1px 0 0 rgba(255,255,255,0.35), inset -1px 0 0 rgba(255,255,255,0.35), 0 12px 32px -8px rgba(26,26,24,0.22), 0 0 0 1px rgba(26,26,24,0.07)',
}

function TabItem({ href, icon, label, active }: {
  href: string; icon: string; label: string; active: boolean
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        textDecoration: 'none',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 10,
        fontWeight: active ? 600 : 500,
        padding: '6px 8px',
        borderRadius: 14,
        minWidth: 44,
        transition: 'color 120ms var(--ease-standard)',
      }}
    >
      <i className={icon} style={{ fontSize: 22 }} />
      <span>{label}</span>
    </Link>
  )
}

function TabBarInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { isSignedIn } = useUser()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

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

  function handleSearchSubmit(e: React.FormEvent) {
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
        zIndex: 100,
        gap: 10,
        alignItems: 'center',
      }}
    >
      {searchOpen ? (
        /* ── Search mode: full-width morphed bar ── */
        <form
          onSubmit={handleSearchSubmit}
          style={{
            flex: 1,
            height: 56,
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px 0 10px',
            gap: 8,
            width: '100%',
            ...LIQUID_GLASS,
          }}
        >
          {/* Home shortcut */}
          <Link
            href="/"
            onClick={() => { setSearchOpen(false); setQuery('') }}
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
            }}
          >
            <i className="iconoir-home-simple" style={{ fontSize: 20 }} />
          </Link>

          {/* Search input */}
          <input
            autoFocus
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

          {/* Clear / close */}
          <button
            type="button"
            onClick={closeSearch}
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
            }}
          >
            <i className="iconoir-xmark" style={{ fontSize: 16 }} />
          </button>
        </form>
      ) : (
        <>
          {/* ── Main pill: 4 tabs ── */}
          <nav
            style={{
              flex: 1,
              height: 56,
              borderRadius: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-around',
              padding: '0 4px',
              ...LIQUID_GLASS,
            }}
          >
            <TabItem href="/" icon="iconoir-home-simple" label="Inicio" active={isActive('/')} />
            <TabItem href="/l" icon="iconoir-heart" label="Favoritos" active={pathname === '/l'} />

            {/* Center publish button — accent circle */}
            <Link
              href="/sell"
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
              }}
            >
              <i className="iconoir-plus" style={{ fontSize: 20 }} />
            </Link>

            <TabItem
              href={isSignedIn ? '/account' : '/sign-in'}
              icon="iconoir-user"
              label={isSignedIn ? 'Perfil' : 'Entrar'}
              active={isActive('/account') || isActive('/sign-in')}
            />
          </nav>

          {/* ── Detached search circle ── */}
          <button
            onClick={() => setSearchOpen(true)}
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
              ...LIQUID_GLASS,
            }}
          >
            <i className="iconoir-search" style={{ fontSize: 22 }} />
          </button>
        </>
      )}
    </div>
  )
}

export default function MobileTabBar() {
  return (
    <Suspense fallback={null}>
      <TabBarInner />
    </Suspense>
  )
}
