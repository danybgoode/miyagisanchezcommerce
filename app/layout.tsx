import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Miyagi Sánchez — Marketplace', template: '%s | Miyagi Sánchez' },
  description: 'Compra y vende productos y servicios cerca de ti.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="border-b border-[var(--color-border)] bg-white">
          <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
            <a href="/" className="font-bold text-[var(--color-text)] text-lg no-underline hover:text-[var(--color-accent)]">
              Miyagi Sánchez
            </a>
            <nav className="flex items-center gap-5 text-sm">
              <a href="/l" className="text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline">Explorar</a>
              <a href="/sell" className="bg-[var(--color-accent)] !text-white px-3 py-1 rounded text-sm font-medium no-underline hover:bg-[var(--color-accent-hover)]">
                Publicar
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="border-t border-[var(--color-border)] mt-16">
          <div className="max-w-6xl mx-auto px-4 py-6 text-xs text-[var(--color-muted)] flex gap-6">
            <span>© 2026 Miyagi Sánchez</span>
            <a href="/l" className="hover:text-[var(--color-text)]">Todos los anuncios</a>
          </div>
        </footer>
      </body>
    </html>
  )
}
