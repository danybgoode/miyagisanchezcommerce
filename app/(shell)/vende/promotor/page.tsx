import type { Metadata } from 'next'
import { currentUser } from '@clerk/nextjs/server'
import es from '@/locales/es.json'
import { getOverriddenDictionary } from '@/lib/copy-overrides'
import { CUSTOM_DOMAIN_PRICE_MXN } from '@/lib/domain-pricing'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId, getPromoterSettings, getCommissionRates, getPromoterSkuPrices } from '@/lib/promoter'
import { SellerAcquisitionPage } from '../_components/SellerAcquisitionSections'
import { buildPromoterPageConfig } from '../_components/page-config'
import { PromoterApplicationForm } from '../_components/PromoterApplicationForm'

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

// Reads the live promoter.enabled flag (below) to hide the close-workspace CTA when the
// program is off — can't be statically generated at build time like a pure content page.
export const dynamic = 'force-dynamic'

export default async function PromoterResourcesPage() {
  const ui = (await getOverriddenDictionary('es')).sellerAcquisition
  const [enabled, user, commissionRates, promoterSettings, skuPrices] = await Promise.all([
    isEnabled('promoter.enabled'),
    currentUser(),
    getCommissionRates(),
    getPromoterSettings(),
    getPromoterSkuPrices(),
  ])
  // A signed-in, already-bound promoter still gets the real "Abrir mi panel" CTA (S1.3) — anyone
  // else (logged out, or logged in but not yet bound) gets the apply-teaser CTA instead.
  const promoter = user ? await getPromoterByClerkId(user.id) : null
  const config = buildPromoterPageConfig(ui, {
    customDomainPriceMxn: CUSTOM_DOMAIN_PRICE_MXN,
    enabled,
    isBoundPromoter: !!promoter,
    commissionRates,
    promoterSettings,
    skuPrices,
  })
  // Sprint 2 · US-2.1: the not-yet-bound applyTeaser gets the real application form as its
  // slot (see SellerAcquisitionSections.tsx's ApplyTeaser.form) — an already-bound promoter has
  // no applyTeaser at all (buildPromoterPageConfig already omits it), so this is a no-op there.
  if (config.applyTeaser) {
    config.applyTeaser = { ...config.applyTeaser, form: <PromoterApplicationForm copy={ui.promotor.apply.form} /> }
  }

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
