import Link from 'next/link'
import { Show, UserButton } from '@clerk/nextjs'
import MobileTabBar from '@/app/components/MobileTabBar'
import AIAgentButton from '@/app/components/AIAgentButton'
import CuentaMenu from '@/app/components/CuentaMenu'
import DesktopUnreadBadge from '@/app/components/DesktopUnreadBadge'
import PlatformBrand from '@/app/components/PlatformBrand'
import PlatformThemeToggle from '@/app/components/PlatformThemeToggle'
import CartButton from '@/app/components/CartButton'
import { getDictionary } from '@/lib/dictionary'
import { NEIGHBORHOOD_PULSE_COPY } from '@/lib/neighborhood-pulse'

/**
 * The marketplace buyer chrome — sticky glass header (search, brand, cart, account,
 * nav), the `platform-main-shell` canvas with seasonal theme-spots, the footer, and
 * the PWA-only tab bar. Lifted verbatim from the old root layout's `showBuyerChrome`
 * block so the static `(site)` shell and the dynamic `(shell)` shell render identical
 * chrome from one source.
 *
 * It reads NO request headers and NO `currentUser()` — it's static-able. The platform
 * seasonal-theme boot script lives in the root `<head>` (it self-gates on pathname +
 * origin-scoped localStorage). `platformThemeEligible` only gates whether the theme
 * TOGGLE surfaces in the account menu, matching the old layout's behavior.
 */
export default async function PlatformShell({
  platformThemeEligible,
  children,
}: {
  platformThemeEligible: boolean
  children: React.ReactNode
}) {
  const dict = await getDictionary('es')
  const themeToggleLabels = dict.platformTheme.toggle
  return (
    <>
      {/* ── Sticky header ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '8px 8px 0',
        }}
      >
        <header
          className="glass"
          style={{
            borderRadius: 'var(--r-lg)',
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              maxWidth: 1152,
              margin: '0 auto',
              gap: 12,
            }}
          >

            {/* ── MOBILE LAYOUT: logo + search + actions ── */}
            <div
              className="flex md:hidden"
              style={{ alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}
            >
              <PlatformBrand variant="mobile" />

              {/* Search bar — stays on mobile web, but HIDDEN in the installed
                  PWA standalone, where the bottom-sheet search is the single
                  primary control (PWA Liquid-Glass Nav Polish S2.2). Desktop
                  search is a separate block below and is untouched. */}
              <form
                action="/l"
                method="GET"
                className="pwa-hidden"
                style={{ flex: 1, minWidth: 0 }}
              >
                <div style={{ position: 'relative' }}>
                  <i
                    className="iconoir-search"
                    style={{
                      position: 'absolute',
                      left: 9,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 14,
                      color: 'var(--fg-subtle)',
                      pointerEvents: 'none',
                      lineHeight: 1,
                    }}
                  />
                  <input
                    name="q"
                    type="search"
                    placeholder="¿Qué estás buscando?"
                    style={{
                      width: '100%',
                      height: 38,
                      background: 'var(--bg-sunk)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-pill)',
                      padding: '0 34px 0 28px',
                      fontSize: 13,
                      fontFamily: 'var(--font-sans)',
                      color: 'var(--fg)',
                      outline: 'none',
                    }}
                  />
                  {/* In-search agent affordance — same sheet as the desktop AIAgentButton */}
                  <AIAgentButton variant="search" />
                </div>
              </form>

              {/* PWA standalone only: the header search (and its in-search agent
                  button) is hidden above, so fill the freed space and re-surface
                  the agent as a top-bar icon — exactly one search + one agent
                  affordance in every mode, no dead space. */}
              <div className="pwa-only" aria-hidden="true" style={{ flex: 1 }} />
              <span className="pwa-only">
                <AIAgentButton variant="icon" />
              </span>

              {/* Sell affordance — publish action when signed in, the labeled "Vende" pitch when signed out */}
              <Show when="signed-in">
                <Link
                  href="/sell"
                  className="icon-btn accent"
                  title="Publicar anuncio"
                >
                  <i className="iconoir-plus-circle" style={{ fontSize: 22 }} />
                </Link>
              </Show>
              <Show when="signed-out">
                <Link href="/vende" className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
                  Vende
                </Link>
              </Show>

              <Link
                href="/vecindario"
                className="icon-btn"
                title={NEIGHBORHOOD_PULSE_COPY.navLabel}
                aria-label={NEIGHBORHOOD_PULSE_COPY.navLabel}
              >
                <i className="iconoir-community" style={{ fontSize: 22 }} />
              </Link>

              {/* Cart */}
              <CartButton />

              {/* Cuenta hub — all account actions (theme, favoritos, agent…) in one menu.
                  Mobile-header instance: drop the Favoritos row in the installed PWA bar
                  (the bottom tab carries it there); it stays in the menu on mobile web. */}
              <Show when="signed-in">
                <CuentaMenu
                  themeEligible={platformThemeEligible}
                  hideFavoritesInPwa
                  themeSlot={
                    <PlatformThemeToggle
                      labels={themeToggleLabels}
                      variant="desktop"
                      initialEligible={platformThemeEligible}
                    />
                  }
                />
              </Show>

              {/* Signed-out has no Cuenta menu — keep the standalone theme toggle
                  (self-hides on ineligible paths). */}
              <Show when="signed-out">
                <PlatformThemeToggle
                  labels={themeToggleLabels}
                  variant="mobile"
                  initialEligible={platformThemeEligible}
                />
              </Show>
            </div>

            {/* ── DESKTOP LAYOUT: brand · centered search + agent · nav ── */}
            <div
              className="hidden md:flex"
              style={{ alignItems: 'center', width: '100%', gap: 16 }}
            >
              <PlatformBrand variant="desktop" />

              {/* Centered persistent search + the single agent affordance */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <form action="/l" method="GET" style={{ flex: 1, maxWidth: 440, minWidth: 0 }}>
                  <div style={{ position: 'relative' }}>
                    <i
                      className="iconoir-search"
                      style={{
                        position: 'absolute',
                        left: 11,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 15,
                        color: 'var(--fg-subtle)',
                        pointerEvents: 'none',
                        lineHeight: 1,
                      }}
                    />
                    <input
                      name="q"
                      type="search"
                      placeholder="¿Qué estás buscando?"
                      style={{
                        width: '100%',
                        height: 38,
                        background: 'var(--bg-sunk)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-pill)',
                        padding: '0 12px 0 32px',
                        fontSize: 13,
                        fontFamily: 'var(--font-sans)',
                        color: 'var(--fg)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </form>
                <AIAgentButton variant="affordance" />
              </div>

              {/* Right nav */}
              <nav style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Link
                  href="/vecindario"
                  style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                  className="hover:text-[var(--fg)]"
                >
                  {NEIGHBORHOOD_PULSE_COPY.navLabel}
                </Link>
                <Show when="signed-in">
                  <Link
                    href="/messages"
                    style={{ position: 'relative', fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                    className="hover:text-[var(--fg)]"
                    title="Mensajes"
                  >
                    <i className="iconoir-chat-bubble" style={{ fontSize: 15, verticalAlign: 'middle' }} />
                    <DesktopUnreadBadge />
                  </Link>
                  <CartButton />
                  <Link href="/sell" className="btn btn-primary btn-sm">
                    <i className="iconoir-plus" style={{ fontSize: 14 }} />
                    Publicar
                  </Link>
                  <CuentaMenu
                    themeEligible={platformThemeEligible}
                    themeSlot={
                      <PlatformThemeToggle
                        labels={themeToggleLabels}
                        variant="desktop"
                        initialEligible={platformThemeEligible}
                      />
                    }
                  />
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  {/* No Cuenta menu when signed out — keep the standalone toggle
                      (self-hides on ineligible paths). */}
                  <PlatformThemeToggle
                    labels={themeToggleLabels}
                    variant="desktop"
                    initialEligible={platformThemeEligible}
                  />
                  <Link href="/vende" className="btn btn-primary btn-sm">
                    Publicar gratis
                  </Link>
                  <Link
                    href="/sign-in"
                    style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                    className="hover:text-[var(--fg)]"
                  >
                    Iniciar sesión
                  </Link>
                </Show>
              </nav>
            </div>

          </div>
        </header>
      </div>

      <main className="platform-main-shell">
        <span aria-hidden className="platform-theme-spot platform-theme-spot-a" />
        <span aria-hidden className="platform-theme-spot platform-theme-spot-b" />
        {children}
      </main>

      {/* Footer — visible on mobile too (S3.3) so the links + Términos aren't dead-ended on phones */}
      <footer data-testid="site-footer" style={{ borderTop: '1px solid var(--border)', marginTop: 64 }}>
        <div
          className="app-shell"
          style={{ paddingTop: 24, paddingBottom: 24, display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}
        >
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>© 2026 Miyagi Sánchez</span>
          <Link href="/l" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Anuncios</Link>
          <Link href="/vecindario" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">{NEIGHBORHOOD_PULSE_COPY.navLabel}</Link>
          <Link href="/vende" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Vende gratis</Link>
          <Link href="/sign-up" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Crear cuenta</Link>
          <Link href="/agent" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">
            Agent API
          </Link>
          <Link href="/terminos" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Términos</Link>
        </div>
      </footer>

      {/* Floating glass tab bar — PWA only (hidden in browser via .pwa-only CSS) */}
      <MobileTabBar search={dict.pwaSearch} />
    </>
  )
}
