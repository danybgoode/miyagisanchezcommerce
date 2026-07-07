import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { normalizeLocale } from '@/lib/dictionary'
import { ABOUT_PAGE, ABOUT_SECTIONS, aboutCopy } from '@/lib/about-content'
import { AboutPage } from './_components/AboutSections'
import { getShop } from '@/lib/listings'
import AcercaBody from '../_shop-content/AcercaBody'
import type { Metadata } from 'next'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/acerca'
const meta = ABOUT_PAGE.es

type AcercaPageProps = {
  searchParams: Promise<{ lang?: string }>
}

// Own-shop premium presentation (epic 07, Sprint 3): this same path also
// serves a shop's own Acerca page on subdomain/custom domain — resolved from
// the unspoofable `x-miyagi-shop-slug` header middleware.ts sets. Absent
// (platform host) ⇒ everything below is byte-for-byte the original platform
// About-Miyagi-Sánchez page.
async function resolveChannelShop() {
  const channelSlug = (await headers()).get('x-miyagi-shop-slug')
  if (!channelSlug) return null
  return getShop(channelSlug)
}

export async function generateMetadata(): Promise<Metadata> {
  const shop = await resolveChannelShop()
  if (shop) return { title: `Acerca — ${shop.name}` }
  return {
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
}

export default async function AcercaPage({ searchParams }: AcercaPageProps) {
  const shop = await resolveChannelShop()
  if (shop) return <AcercaBody shop={shop} basePath="" />

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
