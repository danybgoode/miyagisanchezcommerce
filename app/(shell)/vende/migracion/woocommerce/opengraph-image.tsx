import es from '@/locales/es.json'
import {
  createSellerAcquisitionOgImage,
  sellerAcquisitionOgContentType,
  sellerAcquisitionOgSize,
} from '../../_components/SellerAcquisitionOgImage'

const ui = es.sellerAcquisition.migracionWoocommerce

export const alt = ui.metadata.ogAlt
export const size = sellerAcquisitionOgSize
export const contentType = sellerAcquisitionOgContentType

export default function Image() {
  return createSellerAcquisitionOgImage({
    eyebrow: ui.eyebrow,
    title: ui.heroTitle,
    lead: ui.heroLead,
    path: '/vende/migracion/woocommerce',
    tags: ['Exportador integrado', 'CSV', 'Sin plugins'],
  })
}
