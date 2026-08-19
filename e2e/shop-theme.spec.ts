import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  resolveTheme,
  isKnownPreset,
  THEME_ENUMS,
  THEME_RECIPE_FIELDS,
  DEFAULT_RECIPE,
  PRESET_RECIPES,
} from '../lib/shop-presentation/theme'
import { THEME_PRESETS, isValidThemePresetKey, DEFAULT_THEME_PRESET_KEY } from '../lib/shop-settings/theme-presets'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Living Shop · the theme, as ONE field (Sprint 4, reshaped 2026-08-19).
 *
 * The epic first shipped a second selector (`theme_mode` + `theme_recipe`) in a
 * new studio while the original preset picker stayed live in Diseño — two
 * pickers, two tabs apart, both offering "Clásico" and writing different fields.
 * These specs pin the shape that replaced it: `settings.theme_preset` is the
 * only field that decides how a shop looks, and Retro Social is its sixth value.
 *
 * Observed red by: re-adding a `theme_mode` read to `resolveTheme` (the
 * one-field test failed), by giving a recipe an `accent` field (the
 * one-accent test failed), and by dropping `retro` from THEME_PRESETS (the
 * picker-parity test failed).
 */

test.describe('theme · ONE field decides how a shop looks', () => {
  test('resolveTheme reads theme_preset and nothing else', () => {
    // The regression this prevents by name: a second field that can disagree
    // with the picker a merchant actually used.
    //
    // Asserted on a READ (`settings.theme_mode`), not on the bare word — the
    // header comment explains why the field is gone and legitimately mentions
    // it. A substring match over prose is the mistake this suite has already
    // made twice; see the epic retrospective.
    const source = readFileSync(path.join(ROOT, 'lib/shop-presentation/theme.ts'), 'utf8')
    expect(source).not.toMatch(/settings\.theme_mode|settings\.theme_recipe/)
    expect(source).toMatch(/settings\.theme_preset/)

    // And behaviourally: a stray legacy value must not steer the result.
    const withStrays = resolveTheme({ theme_preset: 'papel', theme_mode: 'retro', theme_recipe: { corners: 'round' } })
    expect(withStrays.preset).toBe('papel')
    expect(withStrays.recipe).toEqual(PRESET_RECIPES.papel)
  })

  test('every picker option resolves, and every resolvable preset is in the picker', () => {
    // Both directions. A picker offering a preset with no recipe renders nothing;
    // a recipe with no picker entry is a look no merchant can reach.
    for (const preset of THEME_PRESETS) {
      if (preset.key === DEFAULT_THEME_PRESET_KEY) continue
      expect(isKnownPreset(preset.key), `${preset.key} has no recipe`).toBe(true)
      expect(isValidThemePresetKey(preset.key), `${preset.key} is not settable`).toBe(true)
    }
    const pickerKeys = new Set(THEME_PRESETS.map((p) => p.key))
    for (const key of Object.keys(PRESET_RECIPES)) {
      expect(pickerKeys.has(key), `${key} has a recipe but is not in the picker`).toBe(true)
    }
  })

  test('Retro Social is one of the presets, not a parallel mode', () => {
    expect(THEME_PRESETS.map((p) => p.key)).toContain('retro')
    expect(resolveTheme({ theme_preset: 'retro' }).presetAttribute).toBe('retro')
  })

  test('no preset means today’s storefront — no attribute at all', () => {
    for (const settings of [{}, { theme_preset: null }, { theme_preset: 'neon-dreams' }, { theme_preset: 42 }]) {
      const theme = resolveTheme(settings as Record<string, unknown>)
      expect(theme.preset).toBeNull()
      expect(theme.presetAttribute).toBeNull()
      expect(theme.recipe).toEqual(DEFAULT_RECIPE)
    }
  })

  test('an unrecognized stored value never becomes an attribute', () => {
    // It would be a seller-controlled string in markup — the one thing the
    // schema exists to prevent.
    expect(resolveTheme({ theme_preset: '"><script>' }).presetAttribute).toBeNull()
  })
})

test.describe('theme · a shop has exactly ONE accent', () => {
  test('a recipe carries no colour field at all', () => {
    // Two accent fields meant a merchant's brand colour changed when they
    // switched looks. The accent is `theme.accent_color`, set in Diseño, and a
    // preset never overrides it.
    for (const recipe of [DEFAULT_RECIPE, ...Object.values(PRESET_RECIPES)]) {
      expect(Object.keys(recipe).sort()).toEqual([...THEME_RECIPE_FIELDS].sort())
      expect(JSON.stringify(recipe)).not.toMatch(/accent|colou?r|#[0-9a-f]{6}/i)
    }
  })

  test('the resolver emits no colour variable', () => {
    for (const key of [null, ...Object.keys(PRESET_RECIPES)]) {
      const vars = resolveTheme(key ? { theme_preset: key } : {}).variables
      expect(Object.keys(vars).sort()).toEqual(
        ['--shop-font-body', '--shop-font-heading', '--shop-radius', '--shop-space'],
      )
      for (const value of Object.values(vars)) {
        expect(value).not.toMatch(/url\(|expression\(|javascript:|<|>|;/)
      }
    }
  })
})

test.describe('theme · the four shipped presets do not visually reset', () => {
  test('each keeps its own CSS block, untouched', () => {
    const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    for (const preset of ['papel', 'pizarra', 'lienzo', 'terracota']) {
      expect(css, preset).toContain(`[data-shop-preset="${preset}"]`)
    }
  })

  test('each resolves to a recipe that matches the character it already had', () => {
    expect(PRESET_RECIPES.papel.typography).toBe('editorial')
    expect(PRESET_RECIPES.pizarra.typography).toBe('tecnica')
    expect(PRESET_RECIPES.lienzo.typography).toBe('geometrica')
    expect(PRESET_RECIPES.terracota.typography).toBe('editorial')
  })

  test('Retro differs structurally from Default — framing, rhythm, identity, not a colour', () => {
    const differing = (Object.keys(PRESET_RECIPES.retro) as Array<keyof typeof DEFAULT_RECIPE>)
      .filter((k) => PRESET_RECIPES.retro[k] !== DEFAULT_RECIPE[k])
    // `wall_layout` used to be on this list. It is gone from the schema
    // entirely — the Wall-beside-rail shell is now every theme's layout, as the
    // design concept has it, so it is no longer something Retro differs BY.
    expect(differing.length).toBeGreaterThanOrEqual(5)
    for (const axis of ['surface', 'typography', 'wall_card', 'identity', 'corners'] as const) {
      expect(differing, axis).toContain(axis)
    }
  })
})

test.describe('theme · the CSS implements exactly what the recipes name', () => {
  const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')

  test('every background treatment a recipe uses has a rule, and none fetches a remote asset', () => {
    const used = new Set(Object.values(PRESET_RECIPES).map((r) => r.background))
    for (const bg of used) {
      if (bg === 'plain') continue // plain is the absence of a treatment, by design
      expect(css, bg).toContain(`[data-shop-background="${bg}"]`)
    }
    const themeBlock = css.slice(css.indexOf('LIVING SHOP — theme engine'))
    expect(themeBlock).not.toMatch(/url\((?!#)/)
  })

  test('every surface treatment a recipe uses has a rule', () => {
    for (const surface of new Set(Object.values(PRESET_RECIPES).map((r) => r.surface))) {
      expect(css, surface).toContain(`[data-shop-surface="${surface}"]`)
    }
  })

  test('Retro has its own block and introduces no era-authentic accessibility defect', () => {
    expect(css).toContain('[data-shop-preset="retro"]')
    // Comments stripped first: the block above Retro EXPLAINS that there is no
    // marquee and no blink, so scanning raw text finds the promise rather than a
    // violation of it. Only declarations count.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const retro = declarations.slice(declarations.indexOf('[data-shop-preset="retro"]'))
    for (const banned of ['marquee', 'blink', 'animation-iteration-count: infinite']) {
      expect(retro.toLowerCase(), banned).not.toContain(banned)
    }
  })

  test('reduced motion is respected inside merchant themes', () => {
    const scoped = css.slice(css.indexOf('LIVING SHOP — theme engine'))
    expect(scoped).toContain('prefers-reduced-motion')
  })

  test('the enum table stays honest: every declared value is spelled the same in CSS or unused', () => {
    // Guards the direction that actually rots — a recipe naming a value the CSS
    // never implements renders nothing and looks like a styling bug.
    for (const bg of THEME_ENUMS.background) {
      const usedByAPreset = Object.values(PRESET_RECIPES).some((r) => r.background === bg)
      if (!usedByAPreset) continue
      if (bg === 'plain') continue
      expect(css, bg).toContain(`[data-shop-background="${bg}"]`)
    }
  })
})
