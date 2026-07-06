import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBaseCssTokens, parseSelectorCssTokens, resolveTokenToHex } from '../lib/design-token-audit'
import { contrastRatio } from '../lib/platform-theme'
import { THEME_PRESETS, DEFAULT_THEME_PRESET_KEY } from '../lib/shop-settings/theme-presets'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const MIN_RATIO = 4.5

test.describe('own-shop premium presentation — theme preset contrast (Sprint 1, Story 1.3)', () => {
  test('every non-default preset resolves fg/fg-muted vs surface/surface-alt at >= 4.5:1', async () => {
    const globalsCss = await readFile(path.join(repoRoot, 'app/globals.css'), 'utf8')
    const baseTokens = parseBaseCssTokens(globalsCss)
    const presets = THEME_PRESETS.filter(p => p.key !== DEFAULT_THEME_PRESET_KEY)

    expect(presets.length).toBeGreaterThan(0)

    const failures: string[] = []
    for (const preset of presets) {
      const overrides = parseSelectorCssTokens(globalsCss, `[data-shop-preset="${preset.key}"]`)
      const tokens = new Map([...baseTokens, ...overrides])

      const surface = resolveTokenToHex(tokens, '--shop-surface')
      const surfaceAlt = resolveTokenToHex(tokens, '--shop-surface-alt')
      const fg = resolveTokenToHex(tokens, '--shop-fg')
      const fgMuted = resolveTokenToHex(tokens, '--shop-fg-muted')

      const pairs: Array<[string, string, string]> = [
        ['fg/surface', fg, surface],
        ['fgMuted/surface', fgMuted, surface],
        ['fg/surfaceAlt', fg, surfaceAlt],
        ['fgMuted/surfaceAlt', fgMuted, surfaceAlt],
      ]
      for (const [label, fore, back] of pairs) {
        const ratio = contrastRatio(fore, back)
        if (ratio < MIN_RATIO) {
          failures.push(`${preset.key} ${label}: ${fore} on ${back} = ${ratio.toFixed(2)} (min ${MIN_RATIO})`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  test('an unset/default preset resolves to the platform base tokens (zero-diff no-op)', async () => {
    const globalsCss = await readFile(path.join(repoRoot, 'app/globals.css'), 'utf8')
    const baseTokens = parseBaseCssTokens(globalsCss)

    expect(resolveTokenToHex(baseTokens, '--shop-surface')).toBe(resolveTokenToHex(baseTokens, '--bg'))
    expect(resolveTokenToHex(baseTokens, '--shop-fg')).toBe(resolveTokenToHex(baseTokens, '--fg'))
  })
})
