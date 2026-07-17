import { createMarketingOgImage, marketingOgSize, marketingOgContentType } from '@/lib/marketing-og'

export const alt = 'Ficha para agentes — Miyagi Sánchez'
export const size = marketingOgSize
export const contentType = marketingOgContentType

export default function Image() {
  return createMarketingOgImage({
    eyebrow: 'Para agentes de IA',
    title: 'Ficha para agentes de IA',
    lead: 'Capacidades, casos de uso UCP, endpoints de la API y cómo operar como dependiente de tienda en miyagisanchez.com.',
    path: '/agent',
    tags: ['UCP', 'MCP', '0% comisión'],
  })
}
