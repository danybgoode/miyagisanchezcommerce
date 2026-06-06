import { test, expect } from '@playwright/test'
import { pickAliasTarget, type PreviousSlug } from '../lib/slug'

/**
 * Custom Slugs · US-4. Pure-logic guard on the old-slug → new-slug 301 decision:
 * a retired slug redirects within its 90-day window, not after; the current slug
 * never self-redirects; unknown slugs don't redirect. No DB; deterministic.
 */
const now = Date.parse('2026-06-05T00:00:00Z')
const future = new Date(now + 30 * 86400_000).toISOString()  // +30d (live)
const past = new Date(now - 1 * 86400_000).toISOString()     // -1d (expired)

const history: PreviousSlug[] = [
  { slug: 'tienda-vieja', until: future },
  { slug: 'nombre-anterior', until: past },
]

test.describe('slug-redirect · pickAliasTarget', () => {
  test('non-expired alias → current slug', () => {
    expect(pickAliasTarget('tienda-nueva', history, 'tienda-vieja', now)).toBe('tienda-nueva')
  })

  test('expired alias → null (no redirect after 90 days)', () => {
    expect(pickAliasTarget('tienda-nueva', history, 'nombre-anterior', now)).toBeNull()
  })

  test('unknown slug → null', () => {
    expect(pickAliasTarget('tienda-nueva', history, 'jamas-existio', now)).toBeNull()
  })

  test('current slug never self-redirects', () => {
    expect(pickAliasTarget('tienda-nueva', history, 'tienda-nueva', now)).toBeNull()
  })

  test('case/space-insensitive on the requested slug', () => {
    expect(pickAliasTarget('tienda-nueva', history, '  Tienda-Vieja ', now)).toBe('tienda-nueva')
  })

  test('empty history → null', () => {
    expect(pickAliasTarget('tienda-nueva', [], 'cualquiera', now)).toBeNull()
  })
})
