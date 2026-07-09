import type { Metadata } from 'next'
import es from '@/locales/es.json'
import { getOverriddenDictionary } from '@/lib/copy-overrides'
import { sellerPersonaCtaHref } from '@/lib/seller-acquisition'
import { SellerAcquisitionPage } from '../_components/SellerAcquisitionSections'
import { buildCreatorPageConfig } from '../_components/page-config'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/vende/creadores'

const meta = es.sellerAcquisition.creadores.metadata

// No manual `images` field — the sibling `opengraph-image.tsx` is auto-detected by Next's
// file-convention metadata resolution. A hardcoded `${PAGE_PATH}/opengraph-image` URL 404s:
// Next serves these at a content-hashed path (e.g. `/vende/creadores/opengraph-image-<hash>`).
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

type CreatorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CreatorSellerPage({ searchParams }: CreatorPageProps) {
  const query = await searchParams
  const ui = (await getOverriddenDictionary('es')).sellerAcquisition
  const config = buildCreatorPageConfig(ui, query)

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
      name: ui.creadores.primaryCta,
      target: `${BASE_URL}${sellerPersonaCtaHref('creadores', query)}`,
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
