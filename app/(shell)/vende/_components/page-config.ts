import type { Dictionary } from '@/lib/dictionary'
import {
  resolveSellerPersonaRoute,
  resolveSellerAcquisitionVariant,
  sellerPersonaCtaHref,
  sellerPersonaRouterHref,
  type SellerAcquisitionVariant,
  type SellerPersonaId,
} from '@/lib/seller-acquisition'
import type { SellerAcquisitionPageConfig } from './SellerAcquisitionSections'

type QueryParams = Record<string, string | string[] | undefined | null>
type SellerAcquisitionCopy = Dictionary['sellerAcquisition']
type AnchorCopy = SellerAcquisitionCopy['anchor']
type CreatorCopy = SellerAcquisitionCopy['creadores']
type LocalBusinessCopy = SellerAcquisitionCopy['negocios']
type ServicesCopy = SellerAcquisitionCopy['servicios']
type VariantCapablePage = {
  heroTitle: string
  primaryCta: string
  closingCta: string
  variants?: Partial<Record<SellerAcquisitionVariant, Partial<{
    heroTitle: string
    primaryCta: string
    closingCta: string
  }>>>
}

export function buildAnchorPageConfig(
  copy: SellerAcquisitionCopy,
  query: QueryParams,
): SellerAcquisitionPageConfig {
  const page = copy.anchor

  return {
    ...baseConfig(copy, page, 'vende', query),
    pageId: 'vende',
    secondaryCta: {
      label: page.secondaryCta,
      href: sellerPersonaRouterHref('mundial', query),
    },
    personaRouter: {
      title: page.routerTitle,
      lead: page.routerLead,
      cards: page.routerCards.map((card) => {
        const personaId = card.personaId as SellerPersonaId
        const route = resolveSellerPersonaRoute(personaId)
        return {
          eyebrow: card.eyebrow,
          title: card.title,
          body: card.body,
          icon: card.icon,
          href: sellerPersonaRouterHref(personaId, query),
          statusLabel: card.statusLabel || (route.status === 'upcoming' ? card.statusLabel : undefined),
          testId: `vende-router-${personaId}`,
        }
      }),
    },
  }
}

export function buildCreatorPageConfig(
  copy: SellerAcquisitionCopy,
  query: QueryParams,
): SellerAcquisitionPageConfig {
  const page = copy.creadores

  return {
    ...baseConfig(copy, page, 'creadores', query),
    pageId: 'creadores',
    secondaryCta: {
      label: page.secondaryCta,
      href: sellerPersonaRouterHref('vende', query),
    },
  }
}

export function buildLocalBusinessPageConfig(
  copy: SellerAcquisitionCopy,
  query: QueryParams,
): SellerAcquisitionPageConfig {
  const page = copy.negocios

  return {
    ...baseConfig(copy, page, 'negocios', query),
    pageId: 'negocios',
    secondaryCta: {
      label: page.secondaryCta,
      href: sellerPersonaRouterHref('vende', query),
    },
  }
}

export function buildServicesPageConfig(
  copy: SellerAcquisitionCopy,
  query: QueryParams,
): SellerAcquisitionPageConfig {
  const page = copy.servicios

  return {
    ...baseConfig(copy, page, 'servicios', query),
    pageId: 'servicios',
    secondaryCta: {
      label: page.secondaryCta,
      href: sellerPersonaRouterHref('vende', query),
    },
  }
}

function baseConfig(
  copy: SellerAcquisitionCopy,
  page: AnchorCopy | CreatorCopy | LocalBusinessCopy | ServicesCopy,
  personaId: SellerPersonaId,
  query: QueryParams,
): SellerAcquisitionPageConfig {
  const variant = resolveSellerAcquisitionVariant(query)
  const variantPage = applySellerAcquisitionPageVariant(page, variant)

  return {
    pageId: personaId,
    variant,
    eyebrow: variantPage.eyebrow,
    title: variantPage.heroTitle,
    lead: variantPage.heroLead,
    trustLine: variantPage.trustLine,
    trustPrompt: copy.shared.trustPrompt,
    copyLabel: copy.shared.copyPrompt,
    copiedLabel: copy.shared.copiedPrompt,
    primaryCta: {
      label: variantPage.primaryCta,
      href: sellerPersonaCtaHref(personaId, query),
      testId: `${personaId}-primary-cta`,
    },
    heroStats: variantPage.heroStats,
    proofTitle: variantPage.proofTitle,
    proofLead: variantPage.proofLead,
    proofPoints: variantPage.proofPoints,
    stepsTitle: variantPage.stepsTitle,
    steps: variantPage.steps,
    agentTitle: variantPage.agentTitle,
    agentBody: variantPage.agentBody,
    socialTitle: variantPage.socialTitle,
    socialBody: variantPage.socialBody,
    socialStats: variantPage.socialStats,
    faqTitle: copy.shared.faqTitle,
    faqs: copy.shared.faqs,
    closingTitle: variantPage.closingTitle,
    closingBody: variantPage.closingBody,
    closingCta: {
      label: variantPage.closingCta,
      href: sellerPersonaCtaHref(personaId, query),
      testId: `${personaId}-closing-cta`,
    },
  }
}

export function applySellerAcquisitionPageVariant<T extends VariantCapablePage>(
  page: T,
  variant: SellerAcquisitionVariant,
): T {
  if (variant === 'a') {
    return page
  }

  const override = page.variants?.[variant]
  if (!override) {
    return page
  }

  return { ...page, ...override }
}
