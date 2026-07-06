/**
 * Own-shop premium presentation (epic 07, Sprint 1, Story 1.3) — curated visual
 * presets: a font pairing + a surface-tone name, layered on top of the seller's
 * own accent color + banner (unchanged). No hex values live here — every
 * preset's actual color tokens live in `app/globals.css` as
 * `[data-shop-preset="<key>"]` CSS-variable blocks (the raw-color CI guard
 * excludes `globals.css`; components must reference `var(--shop-*)`, never an
 * inline hex, which is what keeps this guard-clean — see
 * `lib/design-token-audit.ts`). Contrast for every preset is asserted by
 * `e2e/theme-preset-contrast.spec.ts` against the seasonal-theme-engine's
 * `contrastRatio()` (`lib/platform-theme.ts`).
 *
 * No preset selected (`theme_preset` absent/null) renders today's storefront
 * unchanged — the `default` entry exists only so the Diseño picker has a
 * "none" option; it is never written to CSS.
 */

export interface ThemePreset {
  key: string
  label: string
  description: string
}

export const DEFAULT_THEME_PRESET_KEY = 'default'

export const THEME_PRESETS: ThemePreset[] = [
  { key: 'default', label: 'Clásico', description: 'El look actual de tu tienda — sin cambios.' },
  { key: 'papel', label: 'Papel', description: 'Tonos cálidos de papel, tipografía editorial.' },
  { key: 'pizarra', label: 'Pizarra', description: 'Superficie fría en gris pizarra, tipografía técnica.' },
  { key: 'lienzo', label: 'Lienzo', description: 'Blanco de galería, tipografía elegante para producto.' },
  { key: 'terracota', label: 'Terracota', description: 'Superficie cálida terracota, tipografía artesanal.' },
]

const THEME_PRESET_KEYS = new Set(THEME_PRESETS.map(p => p.key))

/** Whether `key` is a valid, non-default preset id that a component should apply as `data-shop-preset`. */
export function isValidThemePresetKey(key: string): boolean {
  return THEME_PRESET_KEYS.has(key) && key !== DEFAULT_THEME_PRESET_KEY
}
