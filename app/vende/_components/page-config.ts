import type { Dictionary } from '@/lib/dictionary'
import {
  resolveSellerPersonaRoute,
  sellerPersonaCtaHref,
  sellerPersonaRouterHref,
  type SellerPersonaId,
} from '@/lib/seller-acquisition'
import type { SellerAcquisitionPageConfig } from './SellerAcquisitionSections'

type QueryParams = Record<string, string | string[] | undefined | null>
type SellerAcquisitionCopy = Dictionary['sellerAcquisition']
type AnchorCopy = SellerAcquisitionCopy['anchor']
type CreatorCopy = SellerAcquisitionCopy['creadores']
type LocalBusinessCopy = SellerAcquisitionCopy['negocios']

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

function baseConfig(
  copy: SellerAcquisitionCopy,
  page: AnchorCopy | CreatorCopy | LocalBusinessCopy,
  personaId: SellerPersonaId,
  query: QueryParams,
): SellerAcquisitionPageConfig {
  return {
    pageId: personaId,
    eyebrow: page.eyebrow,
    title: page.heroTitle,
    lead: page.heroLead,
    trustLine: page.trustLine,
    trustPrompt: copy.shared.trustPrompt,
    copyLabel: copy.shared.copyPrompt,
    copiedLabel: copy.shared.copiedPrompt,
    primaryCta: {
      label: page.primaryCta,
      href: sellerPersonaCtaHref(personaId, query),
      testId: `${personaId}-primary-cta`,
    },
    heroStats: page.heroStats,
    proofTitle: page.proofTitle,
    proofLead: page.proofLead,
    proofPoints: page.proofPoints,
    stepsTitle: page.stepsTitle,
    steps: page.steps,
    agentTitle: page.agentTitle,
    agentBody: page.agentBody,
    socialTitle: page.socialTitle,
    socialBody: page.socialBody,
    socialStats: page.socialStats,
    faqTitle: copy.shared.faqTitle,
    faqs: copy.shared.faqs,
    closingTitle: page.closingTitle,
    closingBody: page.closingBody,
    closingCta: {
      label: page.closingCta,
      href: sellerPersonaCtaHref(personaId, query),
      testId: `${personaId}-closing-cta`,
    },
  }
}
