import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { esMX } from '@clerk/localizations'
import { CartProvider } from '@/app/components/CartContext'
import CartDrawer from '@/app/components/CartDrawer'
import SiteAnalytics from '@/app/components/SiteAnalytics'
import './globals.css'
// hyper-performant-website S2 · Story 2.1 — replaces the old render-blocking
// `<link>` to cdn.jsdelivr.net/gh/iconoir-icons/iconoir@main (204 KiB,
// unpinned @main — see lib/iconoir-subset.ts's header comment). GENERATED —
// regenerate with `npm run build:iconoir`, never hand-edit.
import './iconoir-subset.css'

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
    default: 'Miyagi Sánchez — Abre tu tienda, compra y vende',
    template: '%s | Miyagi Sánchez',
  },
  description:
    'El nuevo punto de encuentro para comprar y vender de todo en México. Encuentra cosas de segunda mano, eventos, productos o servicios, abre tu propia tienda y vende sin comisiones.',
  keywords: ['marketplace México', 'segundamano', 'comprar y vender', 'vender sin comisiones', 'abrir tienda online', 'eventos', 'México'],
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
    title: 'Miyagi Sánchez — Abre tu tienda, compra y vende',
    description:
      'El nuevo punto de encuentro para comprar y vender de todo en México. Encuentra cosas de segunda mano, eventos, productos o servicios, abre tu propia tienda y vende sin comisiones.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Miyagi Sánchez — Abre tu tienda, compra y vende',
    description:
      'El nuevo punto de encuentro para comprar y vender de todo en México. Encuentra cosas de segunda mano, eventos, productos o servicios, abre tu propia tienda y vende sin comisiones.',
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

/**
 * Root layout — intentionally STATIC (reads no request headers, no `currentUser()`).
 * Channel detection (custom-domain / subdomain / embed / seller-mode → chrome choice)
 * moved DOWN into `app/(shell)/layout.tsx`, so the marketplace `(site)` tree (the
 * homepage) renders from a header-free layout chain and can become a static CDN asset
 * (marketplace-static-shell epic S1). The dynamic `(shell)` tree keeps the per-request
 * chrome decision. URLs are unchanged — route groups produce no URL segment.
 *
 * The platform seasonal-theme boot script is emitted by the `(site)`/`(shell)` layouts
 * (gated on path eligibility) rather than here, so it stays absent on ineligible pages
 * (e.g. /terminos) — the static root has no path to gate on.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider localization={esMX}>
      <html lang="es" suppressHydrationWarning>
        <head>
          {/* Space Grotesk — display + body */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap"
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
          {/* Site-wide GTM container (GA4 + Clarity as tags inside GTM). Client-gated
              on hostname/path so the static root layout reads no headers. */}
          <SiteAnalytics />
          <CartProvider>
            {children}
            <CartDrawer />
          </CartProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
