/**
 * Living Shop — the shop presentation schema (epic 07, Sprints 3 + 4).
 *
 * Type-only. This is the contract every surface imports: the public renderer,
 * the seller studio, the Storefront-as-Code importer and the MCP tools (epic
 * D12). A second declaration anywhere is a fork.
 *
 * Two separate concerns share this module because they share a home in
 * `metadata.settings` and one normalizer:
 *   - `sections` — WHICH approved destinations exist, and in what nav order.
 *   - `theme_mode` + `theme_recipe` — HOW the approved modules render.
 */

// ── Controlled information architecture (Sprint 3) ───────────────────────────

/**
 * The complete, closed set of shop sections. There is no custom slug, no custom
 * page and no nested tree — a seller emphasizes what they have, they do not
 * invent destinations. Adding a key here is a product decision, not a config
 * change, which is exactly why it is a union and not `string`.
 */
export type SectionKey = 'wall' | 'shop' | 'collections' | 'events' | 'about' | 'faq' | 'policies'

/**
 * Wall and Shop are anchors: the homepage narrative and the complete catalog.
 * Neither can be hidden or reordered — a shop with no route to its products is
 * not a shop, and the Wall is the homepage by definition (product decision 1).
 */
export const REQUIRED_SECTIONS: readonly SectionKey[] = ['wall', 'shop'] as const

/** Everything a seller may show, hide and reorder — after the anchors. */
export const OPTIONAL_SECTIONS: readonly SectionKey[] = ['collections', 'events', 'about', 'faq', 'policies'] as const

export const ALL_SECTIONS: readonly SectionKey[] = [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS] as const

export interface SectionConfig {
  /** Full nav order, anchors first. Always a normalized permutation of known keys. */
  order: SectionKey[]
  /** Keys the seller has deliberately hidden from nav. Anchors can never appear here. */
  hidden: SectionKey[]
}

/**
 * Whether each optional section has anything BEHIND it right now.
 *
 * Separate from `SectionConfig` on purpose: config is what the seller wants,
 * availability is what the data supports, and a nav link is rendered only where
 * the two agree. Conflating them is how a hidden section becomes a dead link
 * (Story 3.2's acceptance names this failure explicitly).
 */
export interface SectionAvailability {
  collections: boolean
  events: boolean
  about: boolean
  faq: boolean
  policies: boolean
}

/** One rendered nav destination. */
export interface SectionNavEntry {
  key: SectionKey
  /** Route relative to the channel base — `''` on an owned host. */
  path: string
}

// ── Theme (Sprint 4) ─────────────────────────────────────────────────────────

/**
 * Three modes, not five presets. `custom` is a schema-driven recipe — never
 * arbitrary CSS, HTML, JavaScript or a webfont URL (product decision 4).
 */
export type ThemeMode = 'default' | 'retro' | 'custom'

export type ThemeTypography = 'sistema' | 'editorial' | 'tecnica' | 'manuscrita' | 'geometrica'
export type ThemeDensity = 'compact' | 'balanced' | 'airy'
export type ThemeCorners = 'square' | 'soft' | 'round'
export type ThemeSurface = 'flat' | 'bordered' | 'elevated'
export type ThemeBackground = 'plain' | 'tinted' | 'paper' | 'grid' | 'dots'
export type ThemeHero = 'none' | 'compact' | 'feature'
export type ThemeWallLayout = 'single' | 'feed-sidebar'
export type ThemeWallCard = 'quiet' | 'framed' | 'editorial'
export type ThemeProductCard = 'quiet' | 'framed' | 'tile'
export type ThemeIdentity = 'compact' | 'standard' | 'prominent'

/**
 * The complete Custom vocabulary. Every axis is a CLOSED enum or a validated
 * colour; there is deliberately no field that can carry a URL, a selector or a
 * declaration. That absence is asserted by a spec over the schema, not promised
 * by this comment.
 */
export interface ThemeRecipe {
  typography: ThemeTypography
  density: ThemeDensity
  corners: ThemeCorners
  surface: ThemeSurface
  background: ThemeBackground
  /** `#rrggbb`, validated. Null means "inherit the shop's existing accent". */
  accent: string | null
  secondary_accent: string | null
  hero: ThemeHero
  wall_layout: ThemeWallLayout
  wall_card: ThemeWallCard
  product_card: ThemeProductCard
  identity: ThemeIdentity
}

/** What the renderer actually consumes: an attribute plus a fixed set of variables. */
export interface ResolvedTheme {
  mode: ThemeMode
  /** `data-shop-theme` — the selector the CSS keys off. */
  attribute: ThemeMode
  /** Legacy `data-shop-preset`, preserved so shipped preset CSS keeps applying (epic D5). */
  presetAttribute: string | null
  recipe: ThemeRecipe
  /** `--shop-*` custom properties. Only ever generated values, never seller strings. */
  variables: Record<string, string>
}
