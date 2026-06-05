import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { ClerkProvider, Show, UserButton } from '@clerk/nextjs'
import MobileTabBar from '@/app/components/MobileTabBar'
import AIAgentButton from '@/app/components/AIAgentButton'
import DesktopUnreadBadge from '@/app/components/DesktopUnreadBadge'
import PlatformBrand from '@/app/components/PlatformBrand'
import PlatformThemeScript from '@/app/components/PlatformThemeScript'
import PlatformThemeToggle from '@/app/components/PlatformThemeToggle'
import ReferralAttribution from '@/app/components/ReferralAttribution'
import { CartProvider } from '@/app/components/CartContext'
import CartDrawer from '@/app/components/CartDrawer'
import CartButton from '@/app/components/CartButton'
import ChannelLayout from '@/app/s/[slug]/ChannelLayout'
import { getDictionary } from '@/lib/dictionary'
import { getShop } from '@/lib/listings'
import { isPlatformThemeEligiblePath } from '@/lib/platform-theme'
import './globals.css'

const BASE_URL = 'https://miyagisanchez.com'

// iOS splash screens — pixel dimensions for every modern iPhone viewport
const SPLASH_SCREENS = [
  // iPhone SE 1st gen
  { dw: 320, dh: 568, dpr: 2, pw: 640,  ph: 1136 },
  // iPhone 8 / 7 / 6s / 6
  { dw: 375, dh: 667, dpr: 2, pw: 750,  ph: 1334 },
  // iPhone 8 Plus / 7 Plus / 6s Plus
  { dw: 414, dh: 736, dpr: 3, pw: 1242, ph: 2208 },
  // iPhone X / XS / 11 Pro / 12 mini / 13 mini
  { dw: 375, dh: 812, dpr: 3, pw: 1125, ph: 2436 },
  // iPhone XR / 11
  { dw: 414, dh: 896, dpr: 2, pw: 828,  ph: 1792 },
  // iPhone XS Max / 11 Pro Max
  { dw: 414, dh: 896, dpr: 3, pw: 1242, ph: 2688 },
  // iPhone 12 / 12 Pro / 13 / 13 Pro / 14
  { dw: 390, dh: 844, dpr: 3, pw: 1170, ph: 2532 },
  // iPhone 12 Pro Max / 13 Pro Max / 14 Plus
  { dw: 428, dh: 926, dpr: 3, pw: 1284, ph: 2778 },
  // iPhone 14 Pro / 15 / 15 Pro
  { dw: 393, dh: 852, dpr: 3, pw: 1179, ph: 2556 },
  // iPhone 14 Pro Max / 15 Plus / 15 Pro Max
  { dw: 430, dh: 932, dpr: 3, pw: 1290, ph: 2796 },
] as const

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The embeddable full-shop iframe (/embed/*) is white-label — middleware tags
  // it so we drop the platform header/footer/tab bar and render just the shop.
  const hdrs = await headers()
  const isEmbed = hdrs.get('x-miyagi-embed') === '1'
  const platformPath = hdrs.get('x-miyagi-path') ?? '/'

  // Custom-domain ("own channel") requests are also white-label: middleware tags
  // them with the resolved shop slug so we drop platform chrome here and wrap the
  // WHOLE storefront (homepage, PDP, cart, account…) in the shop's branded shell.
  const isChannel = hdrs.get('x-miyagi-channel') === 'custom'
  const channelSlug = hdrs.get('x-miyagi-shop-slug') ?? ''
  const channelDomain = hdrs.get('x-miyagi-domain') ?? ''
  const channelShop = isChannel && channelSlug ? await getShop(channelSlug) : null
  const channelSettings = ((channelShop?.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const channelTheme = (channelSettings.theme ?? {}) as { accent_color?: string | null }
  const channelAccent = channelTheme.accent_color ?? '#1d6f42'

  // White-label = no platform chrome (embed iframe OR a live custom domain).
  const whiteLabel = isEmbed || isChannel
  const platformThemeEligible = !whiteLabel && isPlatformThemeEligiblePath(platformPath)
  const dict = await getDictionary('es')
  const themeToggleLabels = dict.platformTheme.toggle
  return (
    <ClerkProvider>
      <html lang="es" suppressHydrationWarning>
        <head>
          {platformThemeEligible && <PlatformThemeScript />}

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

          {/* iOS PWA: explicit apple-touch-icon for Safari (stable URL beats Next.js hashed path) */}
          <link rel="apple-touch-icon" href="/apple-icon.png" />

          {/* iOS PWA: splash screens for every iPhone viewport.
              Apple fetches these once at Add-to-Home-Screen time.
              The /api/splash route renders them via ImageResponse. */}
          {SPLASH_SCREENS.map(({ dw, dh, dpr, pw, ph }) => (
            <link
              key={`${pw}x${ph}`}
              rel="apple-touch-startup-image"
              media={`screen and (device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`}
              href={`/api/splash?w=${pw}&h=${ph}`}
            />
          ))}
        </head>
        <body>
          <CartProvider>
          {!whiteLabel && (
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

                  {/* Search bar — hidden in PWA standalone (search is in bottom tab bar) */}
                  <form
                    action="/l"
                    method="GET"
                    className="pwa-search-hide"
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
                          padding: '0 10px 0 28px',
                          fontSize: 13,
                          fontFamily: 'var(--font-sans)',
                          color: 'var(--fg)',
                          outline: 'none',
                        }}
                      />
                    </div>
                  </form>

                  {/* Fills the space left by hidden search bar in PWA mode */}
                  <div className="pwa-spacer" />

                  {/* Sell icon */}
                  <Link
                    href="/sell"
                    className="icon-btn accent"
                    title="Publicar anuncio"
                  >
                    <i className="iconoir-plus-circle" style={{ fontSize: 22 }} />
                  </Link>

                  {/* Cart */}
                  <CartButton />

                  {/* AI Agent button (client component) */}
                  <AIAgentButton />

                  <PlatformThemeToggle
                    labels={themeToggleLabels}
                    variant="mobile"
                    initialEligible={platformThemeEligible}
                  />

                  {/* Profile link — browser only; PWA tab bar handles this */}
                  <Show when="signed-in">
                    <Link
                      href="/account"
                      className="icon-btn pwa-search-hide"
                      title="Mi cuenta"
                      aria-label="Mi cuenta"
                    >
                      <i className="iconoir-user" style={{ fontSize: 22 }} />
                    </Link>
                  </Show>
                </div>

                {/* ── DESKTOP LAYOUT: full wordmark + nav ── */}
                <div
                  className="hidden md:flex"
                  style={{ alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 16 }}
                >
                  <PlatformBrand variant="desktop" />

                  {/* Desktop nav */}
                  <nav style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <PlatformThemeToggle
                      labels={themeToggleLabels}
                      variant="desktop"
                      initialEligible={platformThemeEligible}
                    />
                    <Link
                      href="/l"
                      style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                      className="hover:text-[var(--fg)]"
                    >
                      Explorar
                    </Link>
                    <Link
                      href="/agent"
                      style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                      className="hover:text-[var(--fg)]"
                      title="AI Agent briefing"
                    >
                      <i className="iconoir-sparks" style={{ fontSize: 15, verticalAlign: 'middle' }} />
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
                      <Link
                        href="/account/favorites"
                        style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                        className="hover:text-[var(--fg)]"
                        title="Favoritos"
                      >
                        <i className="iconoir-heart" style={{ fontSize: 15, verticalAlign: 'middle' }} />
                      </Link>
                      <CartButton />
                      <Link
                        href="/shop/manage"
                        style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}
                        className="hover:text-[var(--fg)]"
                      >
                        Mi tienda
                      </Link>
                      <Link href="/sell" className="btn btn-primary btn-sm">
                        <i className="iconoir-plus" style={{ fontSize: 14 }} />
                        Publicar
                      </Link>
                      <Link
                        href="/account"
                        style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                        className="hover:text-[var(--fg)]"
                        title="Mi cuenta"
                      >
                        <i className="iconoir-user" style={{ fontSize: 15 }} />
                        Mi cuenta
                      </Link>
                      <UserButton />
                    </Show>
                    <Show when="signed-out">
                      <Link href="/sell" className="btn btn-primary btn-sm">
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
          </>
          )}

          {isChannel && channelShop ? (
            <ChannelLayout
              shopName={channelShop.name}
              accentColor={channelAccent}
              logoUrl={channelShop.logo_url ?? null}
              domain={channelDomain}
            >
              {children}
            </ChannelLayout>
          ) : (
            <main className={!whiteLabel ? 'platform-main-shell' : undefined}>
              {!whiteLabel && (
                <>
                  <span aria-hidden className="platform-theme-spot platform-theme-spot-a" />
                  <span aria-hidden className="platform-theme-spot platform-theme-spot-b" />
                </>
              )}
              {children}
            </main>
          )}
          <ReferralAttribution />

          {!whiteLabel && (
          <>
          <footer className="hidden md:block" style={{ borderTop: '1px solid var(--border)', marginTop: 64 }}>
            <div
              className="app-shell"
              style={{ paddingTop: 24, paddingBottom: 24, display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}
            >
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>© 2026 Miyagi Sánchez</span>
              <Link href="/l" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Anuncios</Link>
              <Link href="/sell" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Vende gratis</Link>
              <Link href="/sign-up" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Crear cuenta</Link>
              <Link href="/agent" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">
                <i className="iconoir-sparks" style={{ fontSize: 11 }} /> Agent API
              </Link>
            </div>
          </footer>

          {/* Floating glass tab bar — PWA only (hidden in browser via .pwa-only CSS) */}
          <MobileTabBar />
          </>
          )}
          <CartDrawer />
          </CartProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
