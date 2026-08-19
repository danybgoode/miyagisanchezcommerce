import en from '@/locales/en.json'
import {
  createSellerAcquisitionOgImage,
  sellerAcquisitionOgContentType,
  sellerAcquisitionOgSize,
} from '@/app/(shell)/mx/vende/_components/SellerAcquisitionOgImage'

const ui = en.sellerAcquisition.us

export const alt = ui.metadata.ogAlt
export const size = sellerAcquisitionOgSize
export const contentType = sellerAcquisitionOgContentType

// Same branded frame as every `/mx/vende/*` card, in the US market's own language
// and tags — a shared US landing link should look like the platform, not like a
// bare URL, and the tags say what the page can actually back (USD via Stripe, 0%,
// agent-readable) rather than translating the Mexican card's peso claims.
export default function Image() {
  return createSellerAcquisitionOgImage({
    eyebrow: ui.eyebrow,
    title: ui.heroTitle,
    lead: ui.heroLead,
    path: '/us/sell',
    tags: ['0% commission', 'United States', 'AI'],
  })
}
