import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  resolveTheme,
  normalizeThemeMode,
  normalizeRecipe,
  validateRecipe,
  isSafeColor,
  THEME_MODES,
  THEME_ENUMS,
  THEME_RECIPE_FIELDS,
  DEFAULT_RECIPE,
  RETRO_RECIPE,
  LEGACY_PRESET_RECIPES,
} from '../lib/shop-presentation/theme'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Living Shop · Sprint 4 — the theme engine (Stories 4.1–4.5).
 *
 * The two properties this whole sprint rests on:
 *   1. Custom mode exposes NO arbitrary CSS/HTML/JS/font-URL escape hatch, and
 *      that absence is asserted over the SCHEMA rather than promised in a
 *      comment.
 *   2. A shop that never chose a mode does not change appearance.
 *
 * Observed red by: adding a `custom_css` field to the recipe (the escape-hatch
 * test failed), by letting `isSafeColor` accept any string (the injection cases
 * failed), and by dropping the legacy-preset branch from `resolveTheme` (the
 * no-visual-reset test failed).
 */

test.describe('theme · Custom mode has NO escape hatch', () => {
  test('every recipe field is a closed enum or a validated colour — nothing free-form', () => {
    const colourFields = new Set(['accent', 'secondary_accent'])
    for (const field of THEME_RECIPE_FIELDS) {
      const isEnum = field in THEME_ENUMS
      const isColour = colourFields.has(field)
      expect(isEnum || isColour, `${field} is neither a closed enum nor a validated colour`).toBe(true)
    }
  })

  test('the schema has no field whose NAME could carry code or a remote asset', () => {
    const forbidden = /css|html|script|js$|javascript|font_url|url|href|src|style|template|embed|iframe/i
    const offenders = THEME_RECIPE_FIELDS.filter((f) => forbidden.test(f))
    expect(offenders).toEqual([])
  })

  test('an unknown field is REFUSED at the write boundary, never silently ignored', () => {
    // Silently dropping it is how an escape hatch creeps in unnoticed — and how a
    // seller comes to believe they configured something they did not.
    for (const hatch of ['custom_css', 'html', 'font_url', 'script']) {
      const result = validateRecipe({ [hatch]: 'anything' })
      expect(result.ok, `${hatch} was accepted`).toBe(false)
      expect(result.issues.join(' ')).toContain(hatch)
    }
  })

  test('an unknown field is DISCARDED by the renderer rather than reaching output', () => {
    const recipe = normalizeRecipe({ custom_css: 'body{display:none}', typography: 'editorial' })
    expect(Object.keys(recipe).sort()).toEqual([...THEME_RECIPE_FIELDS].sort())
    expect(JSON.stringify(recipe)).not.toContain('display:none')
  })

  test('no resolved variable value can carry a declaration or a URL', () => {
    const theme = resolveTheme({
      theme_mode: 'custom',
      theme_recipe: {
        accent: '#ff0000',
        secondary_accent: '#00ff00',
        typography: 'editorial',
      },
    })
    for (const value of Object.values(theme.variables)) {
      expect(value).not.toMatch(/url\(|expression\(|javascript:|<|>|;/)
    }
  })
})

test.describe('theme · colours are validated, not trusted', () => {
  test('accepts a plain six-digit hex', () => {
    expect(isSafeColor('#1d6f42')).toBe(true)
    expect(isSafeColor('#ABCDEF')).toBe(true)
  })

  // The negation of what we ban is asserted above, so this cannot pass by
  // rejecting everything.
  for (const bad of [
    '#fff', 'red', 'rgb(1,2,3)', 'var(--x)', '#1d6f42; background: url(//evil)',
    'url(javascript:alert(1))', 'expression(alert(1))', '', 42, null, undefined,
  ]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      expect(isSafeColor(bad)).toBe(false)
    })
  }

  test('an invalid colour is refused at the write boundary and falls back at render', () => {
    expect(validateRecipe({ accent: 'red' }).ok).toBe(false)
    expect(normalizeRecipe({ accent: 'red' }).accent).toBeNull()
    const theme = resolveTheme({ theme_mode: 'custom', theme_recipe: { accent: 'red' } })
    expect(theme.variables['--shop-accent']).toBeUndefined()
  })
})

test.describe('theme · absent or malformed resolves to Default, never an error', () => {
  test('a shop with no theme settings at all', () => {
    const theme = resolveTheme({})
    expect(theme.mode).toBe('default')
    expect(theme.recipe).toEqual(DEFAULT_RECIPE)
    expect(theme.presetAttribute).toBeNull()
  })

  test('an unknown mode falls back rather than rendering an unknown attribute', () => {
    expect(normalizeThemeMode({ theme_mode: 'neon' })).toBe('default')
    expect(resolveTheme({ theme_mode: 'neon' }).attribute).toBe('default')
  })

  for (const junk of [42, 'nope', [], { theme_recipe: 'not-an-object' }, { theme_recipe: null }]) {
    test(`survives ${JSON.stringify(junk)}`, () => {
      const theme = resolveTheme((junk ?? {}) as Record<string, unknown>)
      expect(THEME_MODES).toContain(theme.mode)
      expect(Object.keys(theme.recipe).sort()).toEqual([...THEME_RECIPE_FIELDS].sort())
    })
  }
})

test.describe('theme · Retro Social is a FINISHED theme, not a preset of Custom', () => {
  test('two shops choosing Retro get the same theme, whatever else they stored', () => {
    const a = resolveTheme({ theme_mode: 'retro' })
    const b = resolveTheme({ theme_mode: 'retro', theme_recipe: { corners: 'round', density: 'airy' } })
    expect(a.recipe).toEqual(RETRO_RECIPE)
    expect(b.recipe).toEqual(RETRO_RECIPE)
  })

  test('it differs from Default in framing, rhythm and typography — not only a colour', () => {
    const differing = (Object.keys(RETRO_RECIPE) as Array<keyof typeof RETRO_RECIPE>)
      .filter((k) => RETRO_RECIPE[k] !== DEFAULT_RECIPE[k])
    expect(differing.length).toBeGreaterThanOrEqual(5)
    expect(differing).toContain('surface')
    expect(differing).toContain('typography')
    expect(differing).toContain('wall_card')
  })
})

test.describe('theme · legacy presets survive with NO backfill (epic D5)', () => {
  test('a shop with a legacy preset and no mode keeps its preset attribute', () => {
    // This is the no-visual-reset guarantee: the shipped `[data-shop-preset]`
    // CSS still paints exactly what it painted yesterday.
    for (const preset of ['papel', 'pizarra', 'lienzo', 'terracota']) {
      const theme = resolveTheme({ theme_preset: preset })
      expect(theme.presetAttribute, preset).toBe(preset)
      expect(theme.mode).toBe('custom')
    }
  })

  test('each legacy preset also maps to a recipe, so the NEW controls describe the shop it already is', () => {
    for (const [preset, recipe] of Object.entries(LEGACY_PRESET_RECIPES)) {
      expect(resolveTheme({ theme_preset: preset }).recipe).toEqual(recipe)
    }
  })

  test('choosing a mode is the ONLY thing that drops the legacy preset', () => {
    expect(resolveTheme({ theme_preset: 'papel', theme_mode: 'default' }).presetAttribute).toBeNull()
    expect(resolveTheme({ theme_preset: 'papel', theme_mode: 'retro' }).presetAttribute).toBeNull()
    // Still Custom → the preset CSS remains, layered under the recipe.
    expect(resolveTheme({ theme_preset: 'papel', theme_mode: 'custom' }).presetAttribute).toBe('papel')
  })

  test('an unrecognized stored preset does not become an attribute', () => {
    // A junk value must not reach `data-shop-preset`, where it would be a
    // seller-controlled string in markup — the one thing this schema forbids.
    expect(resolveTheme({ theme_preset: 'neon-dreams' }).presetAttribute).toBeNull()
    expect(resolveTheme({ theme_preset: 'neon-dreams' }).mode).toBe('default')
  })
})

test.describe('theme · the CSS matches the schema', () => {
  const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')

  test('every mode has a selector that can style it', () => {
    expect(css).toContain('[data-shop-theme]')
    expect(css).toContain('[data-shop-theme="retro"]')
  })

  test('the shipped legacy preset blocks are still present and untouched', () => {
    for (const preset of ['papel', 'pizarra', 'lienzo', 'terracota']) {
      expect(css, preset).toContain(`[data-shop-preset="${preset}"]`)
    }
  })

  test('Retro introduces no inaccessible era-authentic behaviour', () => {
    // Nostalgia is visual. These were the actual defects of that era's pages and
    // reproducing them would trade a merchant's expression against a buyer's
    // access, which Story 4.3 forbids.
    const retroBlock = css.slice(css.indexOf('[data-shop-theme="retro"]'))
    for (const banned of ['marquee', 'blink', 'animation: blink', 'text-decoration: blink']) {
      expect(retroBlock.toLowerCase(), banned).not.toContain(banned)
    }
  })

  test('reduced motion is respected inside merchant themes too', () => {
    expect(css).toContain('prefers-reduced-motion')
    const scoped = css.slice(css.indexOf('[data-shop-theme]'))
    expect(scoped).toContain('prefers-reduced-motion')
  })

  test('every background treatment in the enum has a rule, and none fetches a remote asset', () => {
    for (const bg of THEME_ENUMS.background) {
      if (bg === 'plain') continue // plain is the absence of a treatment, by design
      expect(css, bg).toContain(`[data-shop-background="${bg}"]`)
    }
    const themeBlock = css.slice(css.indexOf('LIVING SHOP — theme engine v2'))
    expect(themeBlock).not.toMatch(/url\((?!#)/)
  })
})
