import es from '@/locales/es.json'
import {
  createSellerAcquisitionOgImage,
  sellerAcquisitionOgContentType,
  sellerAcquisitionOgSize,
} from '../_components/SellerAcquisitionOgImage'

const ui = es.sellerAcquisition.fundadoras

export const alt = ui.metadata.ogAlt
export const size = sellerAcquisitionOgSize
export const contentType = sellerAcquisitionOgContentType

export default function Image() {
  return createSellerAcquisitionOgImage({
    eyebrow: ui.eyebrow,
    title: ui.heroTitle,
    lead: ui.heroLead,
    path: '/vende/fundadoras',
    tags: ['25 lugares', 'Acompañamiento', 'Vista previa privada'],
  })
}
