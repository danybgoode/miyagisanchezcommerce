import { createMarketingOgImage, marketingOgSize, marketingOgContentType } from '@/lib/marketing-og'
import { ABOUT_PAGE } from '@/lib/about-content'

const meta = ABOUT_PAGE.es

export const alt = meta.metaTitle
export const size = marketingOgSize
export const contentType = marketingOgContentType

export default function Image() {
  return createMarketingOgImage({
    eyebrow: meta.eyebrow,
    title: meta.title,
    lead: meta.lead,
    path: '/acerca',
    tags: ['0% comisión', 'IA nativa', 'México'],
  })
}
