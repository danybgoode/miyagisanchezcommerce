import type { Metadata } from 'next'
import { ClerkProvider, Show, UserButton } from '@clerk/nextjs'
import './globals.css'
import SentryInit from './sentry-init'

export const metadata: Metadata = {
  title: { default: 'Miyagi Sánchez — Marketplace', template: '%s | Miyagi Sánchez' },
  description: 'Compra y vende sin comisiones. El marketplace hecho para ti.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="es">
        <body>
          <SentryInit />
          <header className="border-b border-[var(--color-border)] bg-white sticky top-0 z-50">
            <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
              <a href="/" className="font-bold text-[var(--color-text)] text-lg no-underline hover:text-[var(--color-accent)]">
                Miyagi Sánchez
              </a>
              <nav className="flex items-center gap-4 text-sm">
                <a href="/l" className="text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline hidden sm:block">
                  Explorar
                </a>
                <Show when="signed-in">
                  <a
                    href="/shop/manage"
                    className="text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline hidden sm:block"
                  >
                    Mi tienda
                  </a>
                  <a
                    href="/sell"
                    className="bg-[var(--color-accent)] !text-white px-3 py-1.5 rounded text-sm font-medium no-underline hover:bg-[var(--color-accent-hover)] transition-colors"
                  >
                    + Publicar
                  </a>
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  <a
                    href="/sell"
                    className="bg-[var(--color-accent)] !text-white px-3 py-1.5 rounded text-sm font-medium no-underline hover:bg-[var(--color-accent-hover)] transition-colors"
                  >
                    Publicar gratis
                  </a>
                  <a href="/sign-in" className="text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline text-sm">
                    Iniciar sesión
                  </a>
                </Show>
              </nav>
            </div>
          </header>
          <main>{children}</main>
          <footer className="border-t border-[var(--color-border)] mt-16">
            <div className="max-w-6xl mx-auto px-4 py-6 text-xs text-[var(--color-muted)] flex flex-wrap gap-x-6 gap-y-2">
              <span>© 2026 Miyagi Sánchez</span>
              <a href="/l" className="hover:text-[var(--color-text)]">Anuncios</a>
              <a href="/sell" className="hover:text-[var(--color-text)]">Vende gratis</a>
              <a href="/sign-up" className="hover:text-[var(--color-text)]">Crear cuenta</a>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  )
}
