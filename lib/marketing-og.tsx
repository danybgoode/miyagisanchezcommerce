import { ImageResponse } from 'next/og'
import { PLATFORM_OG_COLORS } from '@/lib/platform-theme'

/**
 * Shared branded OG/social-preview template — the single visual frame every
 * marketing/agent-facing page renders through, so a link to `/`, `/vende`,
 * `/acerca`, `/agent`, or any `vende/*` sub-page all read as recognizably
 * "ours" wherever they land (WhatsApp, Telegram, X, iMessage, …), each with
 * its own page-appropriate headline.
 *
 * Originated in `vende/_components/SellerAcquisitionOgImage.tsx` (seller-
 * acquisition family) and generalized here (epic 07,
 * agent-readability-marketing-surface, Story 1.2) so every other marketing
 * surface can reuse it without duplicating the layout. The vende module
 * re-exports from here under its original names so its 11 existing
 * `opengraph-image.tsx` call sites keep working unchanged.
 */
export const marketingOgSize = { width: 1200, height: 630 }
export const marketingOgContentType = 'image/png'

export type MarketingOgConfig = {
  eyebrow: string
  title: string
  lead: string
  path: string
  tags: string[]
}

export function createMarketingOgImage(config: MarketingOgConfig) {
  const colors = PLATFORM_OG_COLORS

  return new ImageResponse(
    (
      <div
        style={{
          background: `linear-gradient(135deg, ${colors.paper} 0%, ${colors.sunk} 100%)`,
          color: colors.ink,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '70px 86px',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 18,
                background: colors.accent,
                color: colors.accentForeground,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 30,
                fontWeight: 800,
              }}
            >
              MS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 34, fontWeight: 800 }}>Miyagi Sánchez</span>
              <span style={{ fontSize: 20, color: colors.muted }}>Vendedores en México</span>
            </div>
          </div>
          <div
            style={{
              border: `2px solid ${colors.border}`,
              borderRadius: 999,
              padding: '12px 22px',
              color: colors.accentInk,
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {config.path}
          </div>
        </div>

        <div style={{ maxWidth: 960, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              color: colors.accentInk,
              background: colors.sunk,
              border: `2px solid ${colors.border}`,
              borderRadius: 999,
              padding: '10px 20px',
              fontSize: 22,
              fontWeight: 700,
              alignSelf: 'flex-start',
            }}
          >
            {config.eyebrow}
          </div>
          <div style={{ fontSize: 72, fontWeight: 850, lineHeight: 0.96, letterSpacing: 0 }}>
            {config.title}
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.25, color: colors.muted, maxWidth: 860 }}>
            {config.lead}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          {config.tags.map((tag) => (
            <div
              key={tag}
              style={{
                background: colors.accent,
                color: colors.accentForeground,
                borderRadius: 999,
                padding: '12px 22px',
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...marketingOgSize },
  )
}
