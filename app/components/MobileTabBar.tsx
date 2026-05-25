'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

function TabItem({ href, icon, label, active }: {
  href: string
  icon: string
  label: string
  active: boolean
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
        fontWeight: 500,
        padding: '4px 6px',
        minWidth: 52,
        transition: 'color 120ms var(--ease-standard)',
      }}
    >
      <i className={icon} style={{ fontSize: 22 }} />
      <span>{label}</span>
    </Link>
  )
}

export default function MobileTabBar() {
  const pathname = usePathname()
  const { isSignedIn } = useUser()

  function active(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <nav
      className="pwa-only"
      style={{
        position: 'fixed',
        bottom: 'max(18px, env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 24px)',
        maxWidth: 480,
        height: 60,
        background: 'rgba(249,249,247,0.82)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        backdropFilter: 'blur(24px) saturate(140%)',
        borderRadius: 28,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.65), 0 12px 30px -8px rgba(26,26,24,0.22), 0 0 0 1px rgba(26,26,24,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        padding: '0 6px',
        zIndex: 100,
      }}
    >
      <TabItem href="/" icon="iconoir-home-simple" label="Inicio" active={active('/')} />
      <TabItem href="/l" icon="iconoir-search" label="Explorar" active={active('/l')} />

      {/* Center publish button — accent circle */}
      <Link
        href="/sell"
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          background: 'var(--accent)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
          flexShrink: 0,
          boxShadow: '0 4px 14px -4px rgba(29,111,66,0.55)',
          transition: 'transform 200ms var(--ease-spring), box-shadow 200ms var(--ease-standard)',
        }}
      >
        <i className="iconoir-plus" style={{ fontSize: 22 }} />
      </Link>

      <TabItem href="/shop/manage" icon="iconoir-shop" label="Tienda" active={active('/shop/manage')} />
      <TabItem
        href={isSignedIn ? '/account' : '/sign-in'}
        icon="iconoir-user"
        label={isSignedIn ? 'Cuenta' : 'Entrar'}
        active={active('/account') || active('/sign-in')}
      />
    </nav>
  )
}
