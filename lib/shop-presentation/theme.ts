/**
 * Living Shop — the theme resolver (epic 07, Sprint 4; reshaped 2026-08-19).
 *
 * ONE field decides how a shop looks: `settings.theme_preset`, the field the
 * shipped Diseño picker has always written. This module turns it into what the
 * renderer consumes — a `data-shop-preset` attribute, a few derived data
 * attributes, and a fixed set of `--shop-*` custom properties.
 *
 * ── WHY THIS WAS RESHAPED ────────────────────────────────────────────────────
 * The epic first shipped a SECOND selector (`theme_mode` + `theme_recipe`) in a
 * new seller studio while the original preset picker stayed live in Diseño. A
 * merchant then had two theme pickers, two tabs apart, both offering "Clásico"
 * and writing different fields — and picking a preset in one silently changed
 * what the other reported, because a legacy preset was mapped to "Custom" at
 * read time. Retro Social is now simply the sixth preset. There is one field,
 * one picker, and no mode that can disagree with it.
 *
 * ── THE COLOUR, STATED ONCE ──────────────────────────────────────────────────
 * A shop has exactly ONE accent: `settings.theme.accent_color`, set in Diseño.
 * A preset never overrides it — that is why switching presets never changes a
 * merchant's brand colour, and why `background: 'tinted'` tints the page with
 * whatever that colour is rather than inventing a palette of its own.
 *
 * Pure and next-free. Absent or unknown input resolves to the plain default
 * rather than throwing: a storefront must not 500 because a config file had a
 * typo in it.
 */

import type {
  ThemeRecipe,
  ResolvedTheme,
  ThemeTypography,
  ThemeDensity,
  ThemeCorners,
  ThemeSurface,
  ThemeBackground,
  ThemeHero,
  ThemeWallLayout,
  ThemeWallCard,
  ThemeProductCard,
  ThemeIdentity,
} from './types'

/**
 * The closed vocabulary a recipe is written in.
 *
 * Recipes are AUTHORED HERE, one per preset — they are not seller input any
 * more. The enums stay because they keep each recipe honest: a preset cannot
 * name a surface treatment the CSS does not implement, and a spec walks this
 * table to prove every value has a rule.
 */
export const THEME_ENUMS = {
  typography: ['sistema', 'editorial', 'tecnica', 'manuscrita', 'geometrica'] as readonly ThemeTypography[],
  density: ['compact', 'balanced', 'airy'] as readonly ThemeDensity[],
  corners: ['square', 'soft', 'round'] as readonly ThemeCorners[],
  surface: ['flat', 'bordered', 'elevated'] as readonly ThemeSurface[],
  background: ['plain', 'tinted', 'paper', 'grid', 'dots'] as readonly ThemeBackground[],
  hero: ['none', 'compact', 'feature'] as readonly ThemeHero[],
  wall_layout: ['single', 'feed-sidebar'] as readonly ThemeWallLayout[],
  wall_card: ['quiet', 'framed', 'editorial'] as readonly ThemeWallCard[],
  product_card: ['quiet', 'framed', 'tile'] as readonly ThemeProductCard[],
  identity: ['compact', 'standard', 'prominent'] as readonly ThemeIdentity[],
} as const

/** Every axis a recipe has. Asserted complete by spec, so a new one cannot be forgotten. */
export const THEME_RECIPE_FIELDS = [
  'typography', 'density', 'corners', 'surface', 'background',
  'hero', 'wall_layout', 'wall_card', 'product_card', 'identity',
] as const

/** No preset selected — today's storefront, unchanged. */
export const DEFAULT_RECIPE: ThemeRecipe = Object.freeze({
  typography: 'sistema',
  density: 'balanced',
  corners: 'soft',
  surface: 'flat',
  background: 'plain',
  hero: 'compact',
  wall_layout: 'single',
  wall_card: 'quiet',
  product_card: 'quiet',
  identity: 'standard',
})

/**
 * One recipe per shipped preset key.
 *
 * The four original presets keep their EXACT shipped look: their colours and
 * fonts still come from the `[data-shop-preset="…"]` blocks in `globals.css`,
 * untouched. The recipe adds only the structural axes those blocks never had
 * (surface framing, background treatment, Wall rhythm), chosen to match the
 * character each preset already has. That is what "no visual reset" means here.
 */
export const PRESET_RECIPES: Record<string, ThemeRecipe> = Object.freeze({
  papel:     Object.freeze({ ...DEFAULT_RECIPE, typography: 'editorial',  background: 'paper',  surface: 'flat',     corners: 'soft' }),
  pizarra:   Object.freeze({ ...DEFAULT_RECIPE, typography: 'tecnica',    background: 'tinted', surface: 'bordered', corners: 'square' }),
  lienzo:    Object.freeze({ ...DEFAULT_RECIPE, typography: 'geometrica', background: 'plain',  surface: 'flat',     corners: 'soft' }),
  terracota: Object.freeze({ ...DEFAULT_RECIPE, typography: 'editorial',  background: 'tinted', surface: 'elevated', corners: 'round' }),
  /**
   * Retro Social — the epic's one genuinely new look.
   *
   * A deliberate early-social-web interpretation: framed modules, a prominent
   * identity, hard corners, heavy borders, a sidebar rhythm on the Wall.
   * Nostalgia is VISUAL — there is no marquee, no blink, no autoplay and no
   * sub-44px target, because reproducing that era's actual accessibility
   * defects would trade a merchant's expression against a buyer's access.
   */
  retro:     Object.freeze({
    typography: 'tecnica',
    density: 'compact',
    corners: 'square',
    surface: 'bordered',
    background: 'tinted',
    hero: 'compact',
    wall_layout: 'feed-sidebar',
    wall_card: 'framed',
    product_card: 'framed',
    identity: 'prominent',
  }),
})

const DENSITY_SPACE: Record<ThemeDensity, string> = { compact: '0.75rem', balanced: '1rem', airy: '1.5rem' }
const CORNER_RADIUS: Record<ThemeCorners, string> = { square: '0px', soft: '0.75rem', round: '1.5rem' }

/**
 * Font stacks are SELF-HOSTED or system stacks only — no new webfont fetch,
 * matching the shipped preset CSS's own rule. Not a style choice: a
 * seller-selectable remote font would be a third-party request on every shop
 * page, which is the escape hatch this schema exists to not have.
 *
 * These duplicate what the `[data-shop-preset]` blocks already set for the four
 * original presets, harmlessly — the CSS wins where both apply, and this covers
 * `retro`, which has no historical block to inherit from.
 */
const TYPOGRAPHY_STACKS: Record<ThemeTypography, { heading: string; body: string }> = {
  sistema:     { heading: 'var(--font-display)', body: 'var(--font-sans)' },
  editorial:   { heading: "ui-serif, Georgia, 'Times New Roman', serif", body: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  tecnica:     { heading: "ui-monospace, 'SF Mono', 'JetBrains Mono', monospace", body: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  manuscrita:  { heading: "ui-rounded, 'Trebuchet MS', 'Segoe UI', sans-serif", body: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  geometrica:  { heading: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif", body: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" },
}

/** Whether a stored value names a preset that actually has a recipe. */
export function isKnownPreset(value: unknown): value is string {
  return typeof value === 'string' && value in PRESET_RECIPES
}

/**
 * Resolve a shop's persisted settings into what the renderer consumes.
 *
 * Reads ONE field. An absent, unknown or malformed `theme_preset` yields the
 * plain default and a null attribute — which is exactly today's storefront.
 */
export function resolveTheme(settings: Record<string, unknown>): ResolvedTheme {
  const stored = settings.theme_preset
  const preset = isKnownPreset(stored) ? stored : null
  const recipe = preset ? PRESET_RECIPES[preset] : DEFAULT_RECIPE

  const type = TYPOGRAPHY_STACKS[recipe.typography]
  return {
    preset,
    // The shipped attribute, unchanged — it is what the existing per-preset CSS
    // blocks key off, and keeping it is the whole no-visual-reset guarantee.
    presetAttribute: preset,
    recipe,
    variables: {
      '--shop-font-heading': type.heading,
      '--shop-font-body': type.body,
      '--shop-space': DENSITY_SPACE[recipe.density],
      '--shop-radius': CORNER_RADIUS[recipe.corners],
    },
  }
}
