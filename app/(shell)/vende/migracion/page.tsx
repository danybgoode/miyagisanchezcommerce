import type { Metadata } from 'next'
import es from '@/locales/es.json'
import { getOverriddenDictionary } from '@/lib/copy-overrides'
import { getPromoterSkuPrices } from '@/lib/promoter'
import { SellerAcquisitionPage } from '../_components/SellerAcquisitionSections'
import { buildMigracionHubPageConfig } from '../_components/page-config'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/vende/migracion'

const meta = es.sellerAcquisition.migracion.metadata

// No manual `images` field — the sibling `opengraph-image.tsx` is auto-detected by Next's
// file-convention metadata resolution (see the autos page's own comment on why a hardcoded
// `${PAGE_PATH}/opengraph-image` URL 404s).
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

export default async function MigracionHubPage() {
  const ui = (await getOverriddenDictionary('es')).sellerAcquisition
  // The migration SKU's price is admin-configurable (platform-migrations S2) — read it
  // live rather than hardcoding $999, same pattern as /vende/promotor's own price stats.
  const prices = await getPromoterSkuPrices()
  const config = buildMigracionHubPageConfig(ui, { migrationPriceMxn: prices.migration ?? null })

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
