import es from '@/locales/es.json'
import {
  createSellerAcquisitionOgImage,
  sellerAcquisitionOgContentType,
  sellerAcquisitionOgSize,
} from '../_components/SellerAcquisitionOgImage'

const ui = es.sellerAcquisition.migracion

export const alt = ui.metadata.ogAlt
export const size = sellerAcquisitionOgSize
export const contentType = sellerAcquisitionOgContentType

export default function Image() {
  return createSellerAcquisitionOgImage({
    eyebrow: ui.eyebrow,
    title: ui.heroTitle,
    lead: ui.heroLead,
    path: '/vende/migracion',
    tags: ['Shopify', 'Tiendanube', 'WooCommerce', 'Big Cartel'],
  })
}
