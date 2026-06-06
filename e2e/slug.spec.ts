import { test, expect } from '@playwright/test'
import { slugify, validateSlug, RESERVED_SLUGS, SLUG_MIN, SLUG_MAX } from '../lib/slug'

/**
 * Custom Slugs · US-1. Pure-logic guards on the shared slug model — the rules
 * every stage (creation field, settings editor, availability API, and the
 * backend PATCH) trusts. No network; deterministic.
 */
test.describe('slug · slugify', () => {
  test('lowercases, strips accents, hyphenates, trims', () => {
    expect(slugify('Mi Tienda Bonita')).toBe('mi-tienda-bonita')
    expect(slugify('  Café & Té  ')).toBe('cafe-te')
    expect(slugify('Ñandú 2024!')).toBe('nandu-2024')
    expect(slugify('---hola---')).toBe('hola')
  })

  test('caps at SLUG_MAX', () => {
    expect(slugify('a'.repeat(80)).length).toBe(SLUG_MAX)
  })
})

test.describe('slug · validateSlug', () => {
  test('accepts well-formed slugs', () => {
    expect(validateSlug('mi-tienda').valid).toBe(true)
    expect(validateSlug('tienda123').valid).toBe(true)
    expect(validateSlug('abc').valid).toBe(true)
  })

  test('rejects too short / too long', () => {
    expect(validateSlug('ab').valid).toBe(false)            // < SLUG_MIN
    expect(validateSlug('a'.repeat(SLUG_MAX + 1)).valid).toBe(false)
  })

  test('rejects leading/trailing hyphens and bad chars', () => {
    expect(validateSlug('-hola').valid).toBe(false)
    expect(validateSlug('hola-').valid).toBe(false)
    expect(validateSlug('Hola').valid).toBe(false)          // uppercase
    expect(validateSlug('mi tienda').valid).toBe(false)     // space
    expect(validateSlug('mi_tienda').valid).toBe(false)     // underscore
  })

  test('rejects reserved words', () => {
    for (const r of ['admin', 'api', 'sell', 's', 'shop', 'mschz']) {
      expect(validateSlug(r).valid).toBe(false)
      expect(RESERVED_SLUGS.has(r)).toBe(true)
    }
  })

  test('SLUG_MIN/MAX are the documented bounds', () => {
    expect(SLUG_MIN).toBe(3)
    expect(SLUG_MAX).toBe(40)
  })
})
