/**
 * Living Shop — the theme resolver (epic 07, Sprint 4).
 *
 * Pure and next-free. ONE function turns whatever is persisted into what the
 * renderer consumes: a `data-shop-theme` attribute, an optional legacy
 * `data-shop-preset`, and a fixed set of `--shop-*` custom properties.
 *
 * 🚨 THE SECURITY PROPERTY, stated once and asserted by spec: **no seller string
 * ever reaches markup**. Every axis is a closed enum, colours are validated to
 * `#rrggbb`, and the output is generated values only. There is deliberately no
 * field that can carry CSS, HTML, JavaScript, a selector or a font URL — and
 * `e2e/shop-theme.spec.ts` proves the absence over the schema rather than
 * trusting this paragraph.
 *
 * FAIL SAFE TO DEFAULT. Absent, unknown or malformed input resolves to Default
 * rather than throwing: a merchant's storefront must not 500 because a config
 * file had a typo in it.
 */

import type {
  ThemeMode,
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

// ── The closed vocabulary ────────────────────────────────────────────────────

export const THEME_MODES: readonly ThemeMode[] = ['default', 'retro', 'custom'] as const

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

/**
 * Every field name the recipe schema has. The Custom-mode safety argument rests
 * on this list being COMPLETE and closed, so it is exported and asserted rather
 * than implied — a new field added without appearing here fails a spec.
 */
export const THEME_RECIPE_FIELDS = [
  'typography', 'density', 'corners', 'surface', 'background',
  'accent', 'secondary_accent', 'hero', 'wall_layout', 'wall_card',
  'product_card', 'identity',
] as const

export const DEFAULT_RECIPE: ThemeRecipe = Object.freeze({
  typography: 'sistema',
  density: 'balanced',
  corners: 'soft',
  surface: 'flat',
  background: 'plain',
  accent: null,
  secondary_accent: null,
  hero: 'compact',
  wall_layout: 'single',
  wall_card: 'quiet',
  product_card: 'quiet',
  identity: 'standard',
})

/**
 * Retro Social is a FINISHED theme, not a preset of Custom. It is spelled out as
 * a recipe so the two modes share one renderer — a second visual implementation
 * is the thing Story 5.5 forbids for the preview and the same argument applies
 * here.
 */
export const RETRO_RECIPE: ThemeRecipe = Object.freeze({
  typography: 'tecnica',
  density: 'compact',
  corners: 'square',
  surface: 'bordered',
  background: 'tinted',
  accent: null,
  secondary_accent: null,
  hero: 'compact',
  wall_layout: 'feed-sidebar',
  wall_card: 'framed',
  product_card: 'framed',
  identity: 'prominent',
})

/**
 * LEGACY COMPATIBILITY, at READ time, with NO backfill (epic D5).
 *
 * Three live shops carried a `theme_preset` when this shipped: papel, pizarra,
 * terracota (lienzo had none). A migration over three rows buys nothing and
 * risks the one thing Story 4.2 forbids — a silent visual reset. So the stored
 * value is never touched, the shipped `[data-shop-preset]` CSS keeps applying
 * exactly as before, and each preset also maps to the recipe closest to it so
 * the NEW controls describe the shop the merchant already has.
 *
 * Choosing a mode in the UI is the only thing that ever overwrites this.
 */
export const LEGACY_PRESET_RECIPES: Record<string, ThemeRecipe> = Object.freeze({
  papel:     Object.freeze({ ...DEFAULT_RECIPE, typography: 'editorial',   background: 'paper',  surface: 'flat',     corners: 'soft' }),
  pizarra:   Object.freeze({ ...DEFAULT_RECIPE, typography: 'tecnica',     background: 'tinted', surface: 'bordered', corners: 'square' }),
  lienzo:    Object.freeze({ ...DEFAULT_RECIPE, typography: 'geometrica',  background: 'plain',  surface: 'flat',     corners: 'soft' }),
  terracota: Object.freeze({ ...DEFAULT_RECIPE, typography: 'editorial',   background: 'tinted', surface: 'elevated', corners: 'round' }),
})

// ── Validation ───────────────────────────────────────────────────────────────

/** `#rrggbb` only. Not `#rgb`, not a name, not a function — one shape, easy to prove safe. */
export function isSafeColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

export function normalizeThemeMode(raw: unknown): ThemeMode {
  const value = (raw ?? {}) as { theme_mode?: unknown; theme_preset?: unknown }
  if (typeof value.theme_mode === 'string' && (THEME_MODES as readonly string[]).includes(value.theme_mode)) {
    return value.theme_mode as ThemeMode
  }
  // A shop that never chose a mode but HAS a legacy preset is treated as Custom
  // pinned to that preset's recipe — which is what "its appearance does not
  // change until it chooses" means in practice.
  if (typeof value.theme_preset === 'string' && value.theme_preset in LEGACY_PRESET_RECIPES) return 'custom'
  return 'default'
}

/** Coerce anything into a complete, legal recipe. Never throws, never rejects. */
export function normalizeRecipe(raw: unknown, base: ThemeRecipe = DEFAULT_RECIPE): ThemeRecipe {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    typography:       pickEnum(r.typography, THEME_ENUMS.typography, base.typography),
    density:          pickEnum(r.density, THEME_ENUMS.density, base.density),
    corners:          pickEnum(r.corners, THEME_ENUMS.corners, base.corners),
    surface:          pickEnum(r.surface, THEME_ENUMS.surface, base.surface),
    background:       pickEnum(r.background, THEME_ENUMS.background, base.background),
    accent:           isSafeColor(r.accent) ? r.accent : base.accent,
    secondary_accent: isSafeColor(r.secondary_accent) ? r.secondary_accent : base.secondary_accent,
    hero:             pickEnum(r.hero, THEME_ENUMS.hero, base.hero),
    wall_layout:      pickEnum(r.wall_layout, THEME_ENUMS.wall_layout, base.wall_layout),
    wall_card:        pickEnum(r.wall_card, THEME_ENUMS.wall_card, base.wall_card),
    product_card:     pickEnum(r.product_card, THEME_ENUMS.product_card, base.product_card),
    identity:         pickEnum(r.identity, THEME_ENUMS.identity, base.identity),
  }
}

export interface ThemeValidationResult {
  ok: boolean
  issues: string[]
  value: ThemeRecipe
}

/**
 * The WRITE boundary. Same split as sections: the renderer forgives, the write
 * path refuses with a reason a seller can act on. An invalid colour must never
 * be silently dropped at save time — the merchant would think it took.
 */
export function validateRecipe(raw: unknown): ThemeValidationResult {
  const issues: string[] = []
  const r = (raw ?? {}) as Record<string, unknown>

  for (const [field, allowed] of Object.entries(THEME_ENUMS)) {
    const v = r[field]
    if (v !== undefined && !(typeof v === 'string' && (allowed as readonly string[]).includes(v))) {
      issues.push(`theme_recipe.${field}: "${String(v)}" no es un valor permitido (${allowed.join(' · ')}).`)
    }
  }
  for (const field of ['accent', 'secondary_accent'] as const) {
    const v = r[field]
    if (v !== undefined && v !== null && !isSafeColor(v)) {
      issues.push(`theme_recipe.${field}: usa un color en formato #rrggbb.`)
    }
  }
  // An unknown field is refused rather than ignored: silently dropping it is how
  // a seller ends up believing they configured something they did not, and it is
  // also the only way an escape-hatch field could ever creep in unnoticed.
  const known = new Set<string>(THEME_RECIPE_FIELDS)
  for (const key of Object.keys(r)) {
    if (!known.has(key)) issues.push(`theme_recipe.${key}: no es una opción de diseño.`)
  }

  return { ok: issues.length === 0, issues, value: normalizeRecipe(raw) }
}

// ── Resolution ───────────────────────────────────────────────────────────────

const TYPOGRAPHY_STACKS: Record<ThemeTypography, { heading: string; body: string }> = {
  sistema:     { heading: 'var(--font-display)', body: 'var(--font-sans)' },
  editorial:   { heading: "ui-serif, Georgia, 'Times New Roman', serif", body: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  tecnica:     { heading: "ui-monospace, 'SF Mono', 'JetBrains Mono', monospace", body: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  manuscrita:  { heading: "ui-rounded, 'Trebuchet MS', 'Segoe UI', sans-serif", body: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  geometrica:  { heading: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif", body: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" },
}

const DENSITY_SPACE: Record<ThemeDensity, string> = { compact: '0.75rem', balanced: '1rem', airy: '1.5rem' }
const CORNER_RADIUS: Record<ThemeCorners, string> = { square: '0px', soft: '0.75rem', round: '1.5rem' }

/**
 * The stacks above are SELF-HOSTED or system stacks only — no new webfont fetch,
 * matching the shipped preset CSS's own rule. That is not a style choice: a
 * seller-selectable remote font would be a network request to a third party on
 * every shop page, which is the escape hatch this schema exists to not have.
 */
export function resolveTheme(settings: Record<string, unknown>): ResolvedTheme {
  const mode = normalizeThemeMode(settings)
  const legacyPreset = typeof settings.theme_preset === 'string' ? settings.theme_preset : null
  const legacyRecipe = legacyPreset && legacyPreset in LEGACY_PRESET_RECIPES
    ? LEGACY_PRESET_RECIPES[legacyPreset]
    : null

  const base = mode === 'retro' ? RETRO_RECIPE : legacyRecipe ?? DEFAULT_RECIPE
  // Retro is a finished theme: a stored recipe does not override it, or the two
  // shops that both chose "Retro Social" would not look like the same theme.
  const recipe = mode === 'custom' ? normalizeRecipe(settings.theme_recipe, base) : base

  const type = TYPOGRAPHY_STACKS[recipe.typography]
  const variables: Record<string, string> = {
    '--shop-font-heading': type.heading,
    '--shop-font-body': type.body,
    '--shop-space': DENSITY_SPACE[recipe.density],
    '--shop-radius': CORNER_RADIUS[recipe.corners],
  }
  // Colours are emitted ONLY after `isSafeColor`, and only as a variable VALUE —
  // never interpolated into a selector, a declaration block or an attribute.
  if (recipe.accent) variables['--shop-accent'] = recipe.accent
  if (recipe.secondary_accent) variables['--shop-accent-2'] = recipe.secondary_accent

  return {
    mode,
    attribute: mode,
    // The legacy attribute is preserved so the shipped preset CSS keeps painting
    // exactly what it painted yesterday — that IS the no-visual-reset guarantee.
    presetAttribute: mode === 'custom' ? legacyPreset : null,
    recipe,
    variables,
  }
}
