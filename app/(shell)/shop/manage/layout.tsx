import { headers } from 'next/headers'
import Link from 'next/link'
import SellerNav from './SellerNav'
import SellerAnnouncementStrip from './SellerAnnouncementStrip'
import { getActiveAnnouncement } from '@/lib/announcements'

/**
 * Seller-mode shell for `/shop/manage/*`.
 *
 * The root `app/layout.tsx` already suppresses the buyer header/footer/MobileTabBar
 * here (via `isSellerModePath`); this nested layout fills that space with a
 * seller-distinct shell — a brand top bar ("Volver a comprar") + the `SellerNav`
 * rail/bar over the existing manage sub-pages.
 *
 * Composition with white-label: on a custom domain/subdomain the root layout wraps
 * everything in `ChannelLayout`, so rendering the seller shell here too would stack
 * two shells. We detect white-label from the same middleware headers and defer —
 * the channel shell owns the chrome; manage just renders plain inside it. This is
 * the "no double-suppression" guarantee, enforced on both layers consistently.
 */
export default async function SellerManageLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers()
  const isEmbed = hdrs.get('x-miyagi-embed') === '1'
  const channel = hdrs.get('x-miyagi-channel')
  const isChannel = channel === 'custom' || channel === 'subdomain'
  const whiteLabel = isEmbed || isChannel

  // White-label host → the root ChannelLayout already owns the chrome. Render the
  // manage pages plainly inside it; no seller shell, no stacked bars.
  if (whiteLabel) return <>{children}</>

  const announcement = await getActiveAnnouncement('seller')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Dark brand top bar ── (brand-accent surface; --fg-inverse on --accent
          is the documented AA pair, theme-safe and design-token-guard clean). */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'var(--accent)',
          color: 'var(--fg-inverse)',
        }}
      >
        <div
          className="app-shell"
          style={{
            minHeight: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 600,
              fontSize: 14,
              fontFamily: 'var(--font-display, var(--font-sans))',
              color: 'var(--fg-inverse)',
            }}
          >
            <i className="iconoir-shop" style={{ fontSize: 18, lineHeight: 1 }} />
            Miyagi Sánchez · Vendedor
          </span>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
              color: 'var(--fg-inverse)',
              opacity: 0.92,
            }}
          >
            <i className="iconoir-arrow-left" style={{ fontSize: 16, lineHeight: 1 }} />
            Volver a comprar
          </Link>
        </div>
      </div>

      <SellerAnnouncementStrip
        announcement={
          announcement && { id: announcement.id, text: announcement.text, ctaLabel: announcement.ctaLabel, ctaLink: announcement.ctaLink }
        }
      />

      {/* ── Rail + content ── */}
      <div
        className="app-shell"
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
          paddingTop: 20,
        }}
      >
        <SellerNav />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            // Reserve room for the fixed mobile seller bar (no-op on desktop).
            paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
