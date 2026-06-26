/**
 * lib/agent-prompt.ts
 *
 * Pure, dependency-free builder for the "Compra con tu agente IA" hand-off prompt
 * (the navbar card in AIAgentButton.tsx). The prompt is **es-MX only** and is
 * deliberately NOT on the bilingual allow-list (AGENTS rule 5).
 *
 * The agent already resolves listings/shops over UCP/MCP, so a contextual prompt
 * only has to hand it the **canonical URL** of whatever the shopper is looking at
 * (Sprint 1 — URL-only, derived from the path via usePathname/useSearchParams).
 * Sprint 2 layers human-readable title/price/shop on top.
 *
 * Kept dependency-free so the Playwright `api` spec can import it directly.
 */

import { PLATFORM_ORIGIN, listingTarget, shopTarget } from './shortlink'

/**
 * What the shopper is looking at, derived from the URL alone (Sprint 1).
 * A discriminated union so each kind carries exactly the fields its template needs.
 */
export type AgentPromptContext =
  | { kind: 'generic' }
  | { kind: 'pdp'; listingId: string }
  | { kind: 'catalog'; search?: string; queryString?: string }
  | { kind: 'shop'; slug: string }
  | { kind: 'account'; orderRef?: string }

/** Minimal read-only view of URLSearchParams (so ReadonlyURLSearchParams fits too). */
type ReadonlyParams = Pick<URLSearchParams, 'get'> & { toString(): string }

/**
 * Catalog filter keys we'll echo into the hand-off URL. The prompt is pasted into
 * the user's agent, so we whitelist known params (drop `utm_*`/arbitrary junk) and
 * sanitize free text — never copy the raw query string verbatim.
 */
const CATALOG_PARAMS = [
  'q', 'category', 'state', 'municipio', 'sort', 'brand', 'condition',
  'min', 'max', 'year', 'km', 'transmission', 'fuel', 'rooms', 'surface', 'property',
] as const

/** Collapse whitespace/newlines and cap length so a value can't carry multi-line instructions. */
function sanitizeParamText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Rebuild the catalog query string from the allow-list only, with sanitized values. */
function buildCatalogQuery(sp?: ReadonlyParams | null): string {
  if (!sp) return ''
  const out = new URLSearchParams()
  for (const key of CATALOG_PARAMS) {
    const val = sanitizeParamText(sp.get(key))
    if (val) out.set(key, val)
  }
  return out.toString()
}

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
 * Map a URL (pathname + searchParams) to the page context. Pure + URL-only.
 * Route groups like `(shell)`/`(site)` don't appear in the pathname, so the live
 * paths are `/l/<id>` (PDP), `/l` (catalog), `/s/<slug>` (shop), `/account/...`.
 * Anything unrecognized falls back to `generic`.
 */
export function resolveAgentContext(
  pathname: string | null | undefined,
  searchParams?: ReadonlyParams | null,
): AgentPromptContext {
  const seg = (pathname || '').split('/').filter(Boolean)

  // PDP: /l/<id>  ·  Catalog: /l (no id)
  if (seg[0] === 'l') {
    const listingId = seg[1]
    if (listingId) return { kind: 'pdp', listingId }
    const search = sanitizeParamText(searchParams?.get('q') || searchParams?.get('category')) || undefined
    const queryString = buildCatalogQuery(searchParams) || undefined
    return { kind: 'catalog', search, queryString }
  }

  // Shop: /s/<slug>
  if (seg[0] === 's' && seg[1]) return { kind: 'shop', slug: seg[1] }

  // Account / orders: /account[/orders[/<id>]]
  if (seg[0] === 'account') {
    const orderRef = seg[1] === 'orders' && seg[2] ? seg[2] : undefined
    return { kind: 'account', orderRef }
  }

  return { kind: 'generic' }
}

/**
 * Build the full es-MX hand-off prompt for a given context. Always returns the
 * preamble + a page-specific ask; never empty.
 */
export function buildAgentPrompt(ctx: AgentPromptContext): string {
  return `${PREAMBLE}\n\n${ask(ctx)}`
}

function ask(ctx: AgentPromptContext): string {
  switch (ctx.kind) {
    case 'pdp':
      return `Quiero que revises este producto del marketplace y me ayudes a decidir o comprarlo:
${listingTarget(ctx.listingId)}
Usa el API del marketplace (UCP/MCP) para ver el detalle, el precio y las opciones de pago, y si quiero, haz una oferta o inicia la compra por mí.`

    case 'shop':
      return `Quiero saber qué vende esta tienda del marketplace y que me ayudes a comprar ahí:
${shopTarget(ctx.slug)}
Usa el API del marketplace (UCP/MCP) para listar sus productos, comparar precios y, si quiero, iniciar una compra o una oferta.`

    case 'catalog': {
      const url = ctx.queryString ? `${PLATFORM_ORIGIN}/l?${ctx.queryString}` : `${PLATFORM_ORIGIN}/l`
      if (ctx.search) {
        return `Estoy explorando el catálogo del marketplace con esta búsqueda: «${ctx.search}».
Revisa estos resultados y ayúdame a encontrar lo mejor: ${url}
Usa la búsqueda del marketplace (UCP/MCP) para refinar por precio, categoría o ubicación.`
      }
      return `Estoy explorando el catálogo del marketplace: ${url}
Usa la búsqueda del marketplace (UCP/MCP) para ayudarme a encontrar lo que busco y refinar por precio, categoría o ubicación.`
    }

    case 'account':
      return `Necesito ayuda con mi cuenta y mis pedidos en el marketplace${ctx.orderRef ? ` (pedido ${ctx.orderRef})` : ''}.
Usa el API del marketplace (UCP/MCP) para revisar el estado del pedido, el envío o un reembolso, y guíame paso a paso.`

    case 'generic':
    default:
      return GENERIC_ASK
  }
}
