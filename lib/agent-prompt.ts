/**
 * lib/agent-prompt.ts
 *
 * Pure, dependency-free builder for the "Compra con tu agente IA" hand-off prompt
 * (the navbar card in AIAgentButton.tsx). The prompt is **es-MX only** and is
 * deliberately NOT on the bilingual allow-list (AGENTS rule 5).
 *
 * The agent already resolves listings/shops over UCP/MCP, so a contextual prompt
 * only has to hand it the **canonical URL** of whatever the shopper is looking at
 * (Sprint 1 — URL-only). Sprint 2 layers human-readable title/price/shop on top.
 *
 * Kept dependency-free so the Playwright `api` spec can import it directly.
 */

import { PLATFORM_ORIGIN } from './shortlink'

/**
 * What the shopper is looking at, derived from the URL alone (Sprint 1).
 * A discriminated union so each kind carries exactly the fields its template needs.
 */
export type AgentPromptContext =
  | { kind: 'generic' }
  | { kind: 'pdp'; listingId: string }
  | { kind: 'catalog'; query?: string }
  | { kind: 'shop'; slug: string }
  | { kind: 'account'; orderRef?: string }

/**
 * Shared preamble so a cold agent still works: it points at the marketplace ficha
 * (/agent) + the UCP spec before any page-specific ask.
 */
const PREAMBLE = `Eres mi asistente de compras para Miyagi Sánchez, el marketplace sin comisiones de México.

Antes de ayudarme, lee estas dos fuentes:
• Ficha del marketplace (endpoint MCP, capacidades UCP y documentación del API): ${PLATFORM_ORIGIN}/agent
• Especificación del Universal Commerce Protocol: https://ucp.dev

Cuando las hayas revisado, podrás buscar productos, hacer ofertas y ayudarme a completar compras o negociaciones a través del API del marketplace. El marketplace admite productos físicos, digitales, servicios, rentas y suscripciones, todos pagables con Stripe, MercadoPago o SPEI.`

const GENERIC_ASK = '¿Qué estás buscando hoy?'

/**
 * Build the full es-MX hand-off prompt for a given context. Always returns the
 * preamble + a page-specific ask; never empty.
 */
export function buildAgentPrompt(ctx: AgentPromptContext): string {
  return `${PREAMBLE}\n\n${ask(ctx)}`
}

function ask(ctx: AgentPromptContext): string {
  switch (ctx.kind) {
    case 'generic':
    default:
      return GENERIC_ASK
  }
}
