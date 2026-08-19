import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  shopInitials,
  heroContent,
  trustChips,
  hasShopStatus,
  relativeDay,
  railOccupiesTrack,
} from '../lib/shop-presentation/chrome'
import { PRESET_RECIPES } from '../lib/shop-presentation/theme'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Living Shop · Sprint 8 — the shop's own chrome.
 *
 * The governing rule these specs exist to hold: **a panel with nothing real
 * behind it does not render.** The design concept is full of plausible copy —
 * "Usually ships in 2–4 days", "Next market: Roma Norte" — and inventing that
 * for a shop that never configured it would put a promise on a merchant's
 * storefront that they never made.
 *
 * Observed red by: making `heroContent().substantial` always true (the
 * nothing-to-say case failed), by having `railOccupiesTrack` ignore its panel
 * count (the empty-column case failed), and by returning all three trust chips
 * unconditionally (the only-real-facts case failed).
 */

test.describe('chrome · identity', () => {
  test('initials come from the first two words', () => {
    expect(shopInitials('Soft Signal Studio')).toBe('SS')
    expect(shopInitials('Panfleto')).toBe('PA')
    expect(shopInitials('  Champions   not  ')).toBe('CN')
  })

  test('a nameless shop still renders something rather than crashing', () => {
    expect(shopInitials('')).toBe('?')
    expect(shopInitials('   ')).toBe('?')
  })

  test('accents and non-Latin names survive', () => {
    expect(shopInitials('Ñandú Éditions')).toBe('ÑÉ')
  })
})

test.describe('chrome · the hero says nothing it was not told', () => {
  const shop = { name: 'Panfleto', description: null, location: null }

  test('a shop with a tagline leads with it', () => {
    const hero = heroContent(shop, 'Jah proveerá.')
    expect(hero.headline).toBe('Jah proveerá.')
    expect(hero.substantial).toBe(true)
  })

  test('a shop with only a description still earns a hero, headed by its name', () => {
    const hero = heroContent({ ...shop, description: 'Fanzines y rarezas.' }, null)
    expect(hero.headline).toBe('Panfleto')
    expect(hero.lead).toBe('Fanzines y rarezas.')
    expect(hero.substantial).toBe(true)
  })

  test('a shop with NEITHER gets no hero at all', () => {
    // The failure this prevents: the shop's own name restated at 64px over an
    // empty frame, which is worse than no hero.
    const hero = heroContent(shop, null)
    expect(hero.substantial).toBe(false)
  })

  test('whitespace is not content', () => {
    expect(heroContent(shop, '   ').substantial).toBe(false)
    expect(heroContent({ ...shop, description: '  ' }, null).substantial).toBe(false)
  })

  test('the eyebrow is the location, or nothing', () => {
    expect(heroContent({ ...shop, location: 'Puebla, Puebla' }, 'x').eyebrow).toBe('Puebla, Puebla')
    expect(heroContent(shop, 'x').eyebrow).toBeNull()
  })
})

test.describe('chrome · trust chips are facts, not decoration', () => {
  test('only what is true renders', () => {
    expect(trustChips({ verified: true, shipsNationwide: false, localPickup: true }).map((c) => c.key))
      .toEqual(['verified', 'pickup'])
  })

  test('a shop with none gets none', () => {
    expect(trustChips({ verified: false, shipsNationwide: false, localPickup: false })).toEqual([])
  })

  // The negation of what we ban — a guard that returned nothing always would
  // pass the test above for the wrong reason.
  test('a shop with all three gets all three', () => {
    expect(trustChips({ verified: true, shipsNationwide: true, localPickup: true })).toHaveLength(3)
  })
})

test.describe('chrome · shop status is real or absent', () => {
  test('no configured dispatch and no event means no panel', () => {
    expect(hasShopStatus({ dispatch: null, nextEvent: null })).toBe(false)
  })

  test('either fact alone earns the panel', () => {
    expect(hasShopStatus({ dispatch: '2–4 días', nextEvent: null })).toBe(true)
    expect(hasShopStatus({ dispatch: null, nextEvent: 'Feria · 22 ago' })).toBe(true)
  })
})

test.describe('chrome · relative dates compare CALENDAR days', () => {
  const now = new Date('2026-08-19T09:00:00.000Z')

  test('something posted late yesterday is "yesterday", not "today"', () => {
    // Elapsed-hours maths would call 23:00 yesterday "10 hours ago" → today,
    // which is not how a person reads their own wall.
    expect(relativeDay('2026-08-18T23:00:00.000Z', now)).toEqual({ kind: 'yesterday' })
  })

  test('earlier the same day is today', () => {
    expect(relativeDay('2026-08-19T01:00:00.000Z', now)).toEqual({ kind: 'today' })
  })

  test('within the week counts days; beyond it falls back to a date', () => {
    expect(relativeDay('2026-08-16T09:00:00.000Z', now)).toEqual({ kind: 'days', days: 3 })
    expect(relativeDay('2026-08-01T09:00:00.000Z', now)).toEqual({ kind: 'absolute' })
  })

  test('a malformed instant degrades to an absolute date rather than throwing', () => {
    expect(relativeDay('not-a-date', now)).toEqual({ kind: 'absolute' })
  })

  test('a future instant reads as today, never as negative days', () => {
    expect(relativeDay('2026-08-20T09:00:00.000Z', now)).toEqual({ kind: 'today' })
  })
})

test.describe('chrome · the rail closes the empty-column defect', () => {
  test('the second track opens only when the recipe asks AND there is content', () => {
    // 🚨 THE REGRESSION THIS PINS. Sprint 4's feed-sidebar recipe made the Wall a
    // two-column grid whose only children were the post cards, so the cards
    // tiled into columns with nothing in the second track.
    expect(railOccupiesTrack('feed-sidebar', 3)).toBe(true)
    expect(railOccupiesTrack('feed-sidebar', 0)).toBe(false)
    expect(railOccupiesTrack('single', 3)).toBe(false)
  })

  test('Retro is the recipe that asks for it', () => {
    expect(PRESET_RECIPES.retro.wall_layout).toBe('feed-sidebar')
  })

  test('the grid is opened by the SHELL, never by the feed itself', () => {
    // The defect's shape: a grid whose children are cards rather than
    // [main, rail]. The shell owns the columns; the feed stays one column.
    const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\.shop-shell\[data-rail="on"\]\s*\{[^}]*grid-template-columns/)
    expect(css).not.toMatch(/\.wall-feed\s*\{[^}]*grid-template-columns/)
  })
})

test.describe('chrome · Retro matches the concept, and stays accessible', () => {
  const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')

  test('the concept palette is present', () => {
    const retro = css.slice(css.indexOf('[data-shop-preset="retro"] {'))
    for (const token of ['#d7dbe8', '#f5f1ff', '#17153a', '#ff4fb3', '#2d245f', '#ffe96c']) {
      expect(retro, token).toContain(token)
    }
  })

  test('the signature elements exist: label bars, hard shadows, the grid background', () => {
    expect(css).toMatch(/\[data-shop-preset="retro"\][^{]*\[data-label\]::before/)
    expect(css).toMatch(/box-shadow:\s*3px 3px 0/)
    expect(css).toContain('background-size: 18px 18px')
  })

  test('CTA targets stay at least 44px, in every theme', () => {
    expect(css).toMatch(/\.shop-cta-primary[^{]*\{[\s\S]*?min-height:\s*44px/)
  })

  test('no era-authentic accessibility defect, in DECLARATIONS not prose', () => {
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const retro = declarations.slice(declarations.indexOf('[data-shop-preset="retro"]'))
    for (const banned of ['marquee', 'blink', 'animation-iteration-count: infinite']) {
      expect(retro.toLowerCase(), banned).not.toContain(banned)
    }
  })

  test('the shop header truncates a long name rather than wrapping', () => {
    expect(css).toMatch(/\.shop-name\s*\{[^}]*text-overflow:\s*ellipsis/)
  })
})

test.describe('chrome · no reactions, ever', () => {
  test('the Wall card has no like, share or save affordance', () => {
    // Product decision 8. The concept mockup shows "♡ 84 · Share · Save"; it is
    // illustrative, and this epic explicitly does not ship social reactions.
    // Comments stripped: the file's own header EXPLAINS that there is no
    // reaction or share UI, so scanning raw text finds the promise rather than a
    // breach of it. This suite has made that mistake three times now.
    const card = readFileSync(path.join(ROOT, 'app/(shell)/_wall/WallEntryCard.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const banned of ['reaction', 'Compartir', '♡', 'onLike', 'Me gusta']) {
      expect(card.toLowerCase(), banned).not.toContain(banned.toLowerCase())
    }
  })
})
