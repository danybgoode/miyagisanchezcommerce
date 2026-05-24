/**
 * ChannelLayout — white-label shell for custom domain ("own channel") requests.
 *
 * Used when a seller's shop is visited via their own domain (e.g. myshop.mx).
 * Renders NO miyagisanchez platform chrome — just the shop's brand.
 * On miyagisanchez.com the standard root layout wraps everything instead.
 */

import type { ReactNode } from 'react'

interface Props {
  shopName: string
  accentColor: string
  logoUrl: string | null
  domain: string
  children: ReactNode
}

export default function ChannelLayout({ shopName, accentColor, logoUrl, domain, children }: Props) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        '--color-accent': accentColor,
        '--color-accent-hover': accentColor,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      } as React.CSSProperties}
    >
      {/* ── Minimal branded nav ────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur-sm"
        style={{ borderColor: 'rgba(0,0,0,0.08)' }}
      >
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo + name */}
          <a href="/" className="flex items-center gap-2.5 no-underline min-w-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={shopName}
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-black/10"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                style={{ backgroundColor: accentColor }}
              >
                {shopName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="font-semibold text-sm truncate" style={{ color: '#111' }}>
              {shopName}
            </span>
          </a>
        </div>
      </header>

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <main className="flex-1 bg-[#fafafa]">
        {children}
      </main>

      {/* ── Minimal footer ────────────────────────────────────────────────── */}
      <footer className="border-t py-5 bg-white" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs"
          style={{ color: '#888' }}>
          <span>© {new Date().getFullYear()} {shopName}</span>
          <a
            href="https://miyagisanchez.com"
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline hover:opacity-70 transition-opacity"
            style={{ color: '#aaa' }}
          >
            Tienda impulsada por Miyagi Sánchez
          </a>
        </div>
      </footer>
    </div>
  )
}
