import type { Metadata } from 'next'
import es from '@/locales/es.json'
import { getDictionary } from '@/lib/dictionary'
import { CUSTOM_DOMAIN_PRICE_MXN } from '@/lib/domain-pricing'
import { SellerAcquisitionPage } from '../_components/SellerAcquisitionSections'
import { buildPromoterPageConfig } from '../_components/page-config'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/vende/promotor'

const meta = es.sellerAcquisition.promotor.metadata

/**
 * Promoter resources mini-site (epic 08 · S4 · US-12). es-MX only (rule #5), like
 * the rest of /vende. A standalone content page (no SellerPersonaId registration)
 * reusing the SellerAcquisitionPage shell: glossary + pricing + the discount pitch
 * + the set-up/hand-off guide. The printable sell-sheet lives at ./sell-sheet.
 */
export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  alternates: { canonical: `${BASE_URL}${PAGE_PATH}` },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: `${BASE_URL}${PAGE_PATH}`,
    siteName: 'Miyagi Sánchez',
    title: meta.title,
    description: meta.description,
  },
  twitter: { card: 'summary_large_image', title: meta.title, description: meta.description },
}

export default async function PromoterResourcesPage() {
  const ui = (await getDictionary('es')).sellerAcquisition
  const config = buildPromoterPageConfig(ui, { customDomainPriceMxn: CUSTOM_DOMAIN_PRICE_MXN })

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: `${BASE_URL}${PAGE_PATH}`,
    inLanguage: 'es-MX',
    isPartOf: { '@type': 'WebSite', name: 'Miyagi Sánchez', url: BASE_URL },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SellerAcquisitionPage config={config} />
    </>
  )
}
