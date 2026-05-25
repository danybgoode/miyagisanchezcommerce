import type { Metadata, Viewport } from 'next'
import { ClerkProvider, Show, UserButton } from '@clerk/nextjs'
import MobileTabBar from '@/app/components/MobileTabBar'
import './globals.css'

const BASE_URL = 'https://miyagisanchez.com'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Miyagi Sánchez — Infraestructura de comercio',
    template: '%s | Miyagi Sánchez',
  },
  description:
    'Publica, vende y cobra sin comisiones. Marketplace · dominio propio · widget · API agentic. Hecho para México.',
  keywords: ['marketplace', 'vender online', 'sin comisiones', 'México', 'comprar y vender'],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Miyagi Sánchez',
  },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: BASE_URL,
    siteName: 'Miyagi Sánchez',
    title: 'Miyagi Sánchez — Infraestructura de comercio',
    description:
      'Publica, vende y cobra sin comisiones. Marketplace · dominio propio · widget · API agentic. Hecho para México.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Miyagi Sánchez — Infraestructura de comercio',
    description:
      'Publica, vende y cobra sin comisiones. Marketplace · dominio propio · widget · API agentic.',
    site: '@miyagisanchez',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
}

export const viewport: Viewport = {
  themeColor: '#1d6f42',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="es">
        <head>
          {/* Space Grotesk — display + body */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap"
          />
          {/* Iconoir — v2 icon library */}
          <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/gh/iconoir-icons/iconoir@main/css/iconoir.css"
          />
        </head>
        <body>
          {/* Floating glass header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 50, padding: '12px 12px 0', background: 'transparent' }}>
            <header
              className="glass"
              style={{
                borderRadius: 'var(--r-lg)',
                height: 48,
                display: 'flex',
                alignItems: 'center',
                padding: '0 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1152, margin: '0 auto', gap: 16 }}>
                {/* Wordmark */}
                <a
                  href="/"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    textDecoration: 'none',
                    lineHeight: 1,
                    gap: 0,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Miyagi</span>
                  <span style={{ color: 'var(--accent)', fontSize: 9, margin: '0 3px', lineHeight: 1, position: 'relative', top: 1 }}>●</span>
                  <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Sánchez</span>
                </a>

                {/* Desktop nav — hidden on mobile (tab bar handles it) */}
                <nav className="hidden md:flex" style={{ alignItems: 'center', gap: 12 }}>
                  <a
                    href="/l"
                    style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                    className="hover:text-[var(--fg)]"
                  >
                    Explorar
                  </a>
                  <Show when="signed-in">
                    <a
                      href="/shop/manage"
                      style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                      className="hover:text-[var(--fg)]"
                    >
                      Mi tienda
                    </a>
                    <a href="/sell" className="btn btn-primary btn-sm">
                      <i className="iconoir-plus" style={{ fontSize: 14 }} />
                      Publicar
                    </a>
                    <UserButton />
                  </Show>
                  <Show when="signed-out">
                    <a href="/sell" className="btn btn-primary btn-sm">
                      Publicar gratis
                    </a>
                    <a
                      href="/sign-in"
                      style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                      className="hover:text-[var(--fg)]"
                    >
                      Iniciar sesión
                    </a>
                  </Show>
                </nav>

                {/* Mobile header right — sign-in shortcut or user avatar */}
                <div className="flex md:hidden" style={{ alignItems: 'center', gap: 8 }}>
                  <Show when="signed-in">
                    <UserButton />
                  </Show>
                  <Show when="signed-out">
                    <a href="/sign-in" className="btn btn-primary btn-sm" style={{ fontSize: 12, padding: '6px 12px' }}>
                      Entrar
                    </a>
                  </Show>
                </div>
              </div>
            </header>
          </div>

          <main>{children}</main>

          <footer className="hidden md:block" style={{ borderTop: '1px solid var(--border)', marginTop: 64 }}>
            <div
              className="app-shell"
              style={{ paddingTop: 24, paddingBottom: 24, display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}
            >
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>© 2026 Miyagi Sánchez</span>
              <a href="/l" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Anuncios</a>
              <a href="/sell" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Vende gratis</a>
              <a href="/sign-up" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Crear cuenta</a>
            </div>
          </footer>

          {/* Floating glass tab bar — mobile only */}
          <MobileTabBar />
        </body>
      </html>
    </ClerkProvider>
  )
}
