import type { Metadata } from 'next'
import es from '@/locales/es.json'
import { getOverriddenDictionary } from '@/lib/copy-overrides'
import { SellerAcquisitionPage } from '../../_components/SellerAcquisitionSections'
import { buildMigracionShopifyPageConfig } from '../../_components/page-config'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/vende/migracion/shopify'

const meta = es.sellerAcquisition.migracionShopify.metadata

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
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
  },
}

export default async function MigracionShopifyPage() {
  const ui = (await getOverriddenDictionary('es')).sellerAcquisition
  const config = buildMigracionShopifyPageConfig(ui)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: `${BASE_URL}${PAGE_PATH}`,
    inLanguage: 'es-MX',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Miyagi Sánchez',
      url: BASE_URL,
    },
    potentialAction: {
      '@type': 'CreateAction',
      name: ui.migracionShopify.primaryCta,
      target: `${BASE_URL}/shop/manage/shopify/import`,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SellerAcquisitionPage config={config} />
    </>
  )
}
