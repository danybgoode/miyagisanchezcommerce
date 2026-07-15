import { expect, test } from '@playwright/test'
import { CATEGORIES } from '../lib/types'

// Homepage Polish — Dirección B · Sprint 1: the buyer surfaces speak one Iconoir
// icon language. This guard locks the migration in two ways:
//   1. pure — every CATEGORIES[].icon is an Iconoir glyph name, not an emoji.
//   2. SSR  — the homepage renders those Iconoir classes and none of the design
//             emoji we removed survive in the server-rendered chrome.
//
// The SSR negative targets the *specific* design-emoji set this sprint removes
// (category glyphs + the "Todo" 🛍️ chip), NOT a blanket emoji-codepoint scan:
// the live home grid shows real listings whose user-authored titles may legibly
// contain an emoji, and that's not "the homepage's emoji language".

// The Iconoir name shape: lowercase words joined by hyphens, digits allowed
// (e.g. `smartphone-device`, `360-view`) — never an emoji.
const ICONOIR_NAME = /^[a-z][a-z0-9-]*[a-z0-9]$/

// The category/chrome emoji that used to live in CATEGORIES + the "Todo" chip.
const REMOVED_DESIGN_EMOJI = [
  '🛍️', '🚗', '🏠', '📱', '🪴', '👗', '⚽', '🔧', '🐾',
  '🔨', '🏭', '🎓', '👥', '🎨', '📦',
] as const

test.describe('homepage icon language', () => {
  test('every category icon is an Iconoir glyph name (no emoji in CATEGORIES)', () => {
    for (const cat of CATEGORIES) {
      expect(cat.icon, `category "${cat.key}" icon`).toMatch(ICONOIR_NAME)
    }
  })

  test('homepage SSR renders Iconoir category glyphs and no removed design emoji', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    // Positive: the category rail rendered Iconoir classes server-side. The lead
    // chip icon is data-independent; individual category icons are asserted
    // generically (home-dynamic-rows-restore-and-polish S3.3 filters Pasillos
    // chips to categories with ≥1 live listing, so a specific category like
    // "autos" is no longer guaranteed present in every environment).
    expect(html).toContain('iconoir-view-grid') // the lead chip, always present
    const anyCategoryIconRendered = CATEGORIES.some(cat => html.includes(`iconoir-${cat.icon}`))
    expect(anyCategoryIconRendered, 'expected at least one Iconoir category glyph in the homepage SSR').toBe(true)

    // Negative: none of the design emoji we migrated away from survive.
    for (const emoji of REMOVED_DESIGN_EMOJI) {
      expect(html, `removed design emoji ${emoji} still in homepage SSR`).not.toContain(emoji)
    }
  })
})
