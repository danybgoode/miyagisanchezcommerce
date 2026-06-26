import type { Metadata } from 'next'
import es from '@/locales/es.json'
import { getDictionary } from '@/lib/dictionary'
import { sellerPersonaCtaHref } from '@/lib/seller-acquisition'
import { SellerAcquisitionPage } from './_components/SellerAcquisitionSections'
import { buildAnchorPageConfig } from './_components/page-config'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/vende'

const meta = es.sellerAcquisition.anchor.metadata
const ogImage = `${BASE_URL}${PAGE_PATH}/opengraph-image`

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
    images: [{ url: ogImage, width: 1200, height: 630, alt: meta.ogAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
    images: [ogImage],
  },
}

type VendePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function VendePage({ searchParams }: VendePageProps) {
  const query = await searchParams
  const ui = (await getDictionary('es')).sellerAcquisition
  const config = buildAnchorPageConfig(ui, query)

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
      name: ui.anchor.primaryCta,
      target: `${BASE_URL}${sellerPersonaCtaHref('vende', query)}`,
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
