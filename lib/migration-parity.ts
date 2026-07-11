/**
 * lib/migration-parity.ts
 *
 * Pure parity scorer for the Shopify connector (epic 03 · platform-migrations,
 * Sprint 1 · US-1.2). Compares Shopify's storefront capabilities against
 * Miyagi's fixed set of storefront primitives, so a migrating merchant sees
 * an honest "this maps, this doesn't" BEFORE any money changes hands.
 *
 * IMPORTANT — what this does and doesn't detect: Sprint 1's connector only
 * pulls a shop's PRODUCT CATALOG + policy/FAQ text via the Storefront-MCP
 * (lib/shopify-mcp-client.ts) — it does NOT scrape the shop's live theme,
 * announcement bar, hero, or extra static pages (Admin-API access is
 * explicitly out of scope, see sprint-1.md). So `PARITY_SECTIONS` below is a
 * STATIC, general-case comparison (true for any Shopify shop migrating in),
 * not a per-shop live feature-detection — the only PER-BATCH numbers are the
 * ones the pull actually measured: listing/image counts, whether policy text
 * came through, and whether the pull was truncated.
 *
 * Confirmed finding (code-verified against lib/shop-settings/*, see
 * sprint-1.md → Findings): Miyagi's content-page model is closed to exactly
 * three fixed pages (Acerca/FAQ/Políticas, and Políticas isn't even
 * independently authored) — no `pages` table, no dynamic route, no way for a
 * seller to add a fourth arbitrary page. Shopify shops commonly have more
 * than three static pages (shipping guides, size charts, brand story, etc.),
 * so `content_pages` below is always `partial`, honestly, not `mapped`.
 *
 * No next/* and no network imports — the Playwright `api` runner unit-tests it.
 */

export type ParitySectionKey = 'announcement' | 'hero' | 'theme' | 'collections' | 'content_pages'
export type ParityVerdict = 'mapped' | 'partial' | 'none'

export interface ParitySection {
  key: ParitySectionKey
  label: string
  verdict: ParityVerdict
  note: string
}

/**
 * The static comparison — Shopify's flexible theme model vs Miyagi's fixed
 * primitives (see file header: not derived from any per-shop scrape).
 */
export const PARITY_SECTIONS: ParitySection[] = [
  {
    key: 'announcement',
    label: 'Barra de anuncio',
    verdict: 'mapped',
    note: 'Miyagi tiene una barra de anuncio en la parte superior de tu tienda, igual que Shopify.',
  },
  {
    key: 'hero',
    label: 'Sección destacada (banner principal)',
    verdict: 'partial',
    note: 'Miyagi ofrece dos formatos: productos destacados o un banner con imagen y botón. No es un editor libre — cubre los casos más comunes, pero no una sección hecha a la medida.',
  },
  {
    key: 'theme',
    label: 'Tema y colores',
    verdict: 'partial',
    note: 'Miyagi tiene 4 estilos de tienda predefinidos (colores y tipografía). No puedes crear un tema totalmente personalizado como en Shopify — eliges el que más se parezca al tuyo.',
  },
  {
    key: 'collections',
    label: 'Colecciones',
    verdict: 'mapped',
    note: 'Miyagi organiza productos en colecciones igual que Shopify.',
  },
  {
    key: 'content_pages',
    label: 'Páginas de contenido (Acerca, FAQ, Políticas)',
    verdict: 'partial',
    note: 'Miyagi tiene exactamente 3 páginas fijas: Acerca de, Preguntas frecuentes y Políticas. Si tu tienda Shopify tiene páginas adicionales (guías de tallas, historia de marca, etc.), esas NO tienen un lugar equivalente todavía.',
  },
]

export interface ParityReportInput {
  listingCount: number
  imageCount: number
  hasPolicies: boolean
  truncated: boolean
}

export interface ParityReport {
  sections: ParitySection[]
  listingCount: number
  imageCount: number
  hasPolicies: boolean
  truncated: boolean
  /** Feeds US-2.3 — should this migration route to Daniel instead of the flat-fee SKU? */
  veryCustom: boolean
  veryCustomReason: string | null
}

/** Sprint 2's flat-fee `migration` SKU covers up to this many listings (epic README). */
export const VERY_CUSTOM_LISTING_THRESHOLD = 150

export function buildParityReport(input: ParityReportInput): ParityReport {
  const overThreshold = input.listingCount > VERY_CUSTOM_LISTING_THRESHOLD
  const veryCustom = overThreshold || input.truncated
  const veryCustomReason = input.truncated
    ? 'El catálogo es muy grande — solo se pudo traer una parte para este reporte.'
    : overThreshold
      ? `Esta tienda tiene más de ${VERY_CUSTOM_LISTING_THRESHOLD} productos, fuera del paquete de precio fijo.`
      : null

  return {
    sections: PARITY_SECTIONS,
    listingCount: input.listingCount,
    imageCount: input.imageCount,
    hasPolicies: input.hasPolicies,
    truncated: input.truncated,
    veryCustom,
    veryCustomReason,
  }
}
