import { createMarketingOgImage, marketingOgSize, marketingOgContentType } from '@/lib/marketing-og'

// Site-wide default OG image (root layout, no page-level opengraph-image.tsx
// overrides it). Reuses the shared marketing-OG template (agent-readability-
// marketing-surface epic, Story 1.2) with the general pitch, so `/` shows the
// same branded visual frame as `/vende`, `/acerca`, and `/agent` — each with
// its own page-appropriate headline.
export const alt = 'Miyagi Sánchez — Abre tu tienda, compra y vende'
export const size = marketingOgSize
export const contentType = marketingOgContentType

export default function OGImage() {
  return createMarketingOgImage({
    eyebrow: 'Marketplace para México',
    title: 'Compra y vende de todo. 0% de comisión.',
    lead: 'Encuentra cosas de segunda mano, eventos, productos o servicios, abre tu propia tienda y vende sin comisiones.',
    path: '/',
    tags: ['Marketplace', 'Segundamano', '0% comisión'],
  })
}
