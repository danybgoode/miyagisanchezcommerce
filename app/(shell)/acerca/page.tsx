import type { Metadata } from 'next'
import { normalizeLocale } from '@/lib/dictionary'
import { ABOUT_PAGE, ABOUT_SECTIONS, aboutCopy } from '@/lib/about-content'
import { AboutPage } from './_components/AboutSections'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/acerca'
const meta = ABOUT_PAGE.es

export const metadata: Metadata = {
  title: meta.metaTitle,
  description: meta.metaDescription,
  alternates: { canonical: `${BASE_URL}${PAGE_PATH}` },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: `${BASE_URL}${PAGE_PATH}`,
    siteName: 'Miyagi Sanchez',
    title: meta.metaTitle,
    description: meta.metaDescription,
  },
}

type AcercaPageProps = {
  searchParams: Promise<{ lang?: string }>
}

export default async function AcercaPage({ searchParams }: AcercaPageProps) {
  const { lang } = await searchParams
  const locale = normalizeLocale(lang)
  const page = ABOUT_PAGE[locale]

  // JSON-LD Organization — grounded description from the what_is section (real text, agent-fetchable).
  const whatIs = ABOUT_SECTIONS.find((s) => s.id === 'what_is')
  const description = whatIs ? aboutCopy(whatIs, locale).body[0] : page.metaDescription
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Miyagi Sanchez',
    url: BASE_URL,
    description,
    inLanguage: locale === 'en' ? 'en' : 'es-MX',
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AboutPage locale={locale} />
    </>
  )
}
